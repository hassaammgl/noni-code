export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

export interface Todo {
    id: string;
    title: string;
    status: TodoStatus;
    notes?: string;
    parentId?: string;
    children: string[];
}

export interface TodoInput {
    title: string;
    notes?: string;
    subtasks?: TodoInput[];
}

const STATUSES: TodoStatus[] = ["pending", "in_progress", "done", "blocked"];
const MARK: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    done: "[x]",
    blocked: "[!]",
};

export function isTodoStatus(raw: unknown): raw is TodoStatus {
    return typeof raw === "string" && (STATUSES as string[]).includes(raw);
}

function cleanTitle(raw: unknown): string {
    const t = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!t) throw new Error("title is empty");
    return t.length > 200 ? `${t.slice(0, 197)}...` : t;
}

function cleanNotes(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const n = String(raw).trim();
    if (!n) return undefined;
    return n.length > 1_000 ? `${n.slice(0, 997)}...` : n;
}

function indentOf(line: string): number {
    let n = 0;
    for (const ch of line) {
        if (ch === " ") n++;
        else if (ch === "\t") n += 2;
        else break;
    }
    return n;
}

/** Rendered tree se copy aaye to "[ ]" / "[x]" marker title me na jaye. */
function stripStatusMark(text: string): string {
    return text.replace(/^\[[ xX~!]\]\s*/, "").trim();
}

/** Remove prefixes like "1.2 Title", "1) Title", "- Title"; numbered lines also indicate depth. */
function bulletText(line: string): { text: string; numberDepth?: number } {
    const trimmed = line.trim();
    const dotted = /^(\d+(?:\.\d+)+)[.)]?\s+(.+)$/.exec(trimmed);
    if (dotted) return { text: stripStatusMark(dotted[2]!), numberDepth: dotted[1]!.split(".").length - 1 };
    const single = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (single) return { text: stripStatusMark(single[2]!), numberDepth: 0 };
    const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (bullet) return { text: stripStatusMark(bullet[1]!) };
    return { text: stripStatusMark(trimmed) };
}

/**
 * Chhote models ke liye sabse aasan format: indented outline.
 * "1. Build\n  1.1 API\n  1.2 UI\n2. Test" -> nested subtasks.
 */
export function parseOutline(raw: string): TodoInput[] {
    const items = raw
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => ({ indent: indentOf(line), ...bulletText(line) }));
    if (!items.length) throw new Error("outline is empty");

    const roots: TodoInput[] = [];
    const numbering = items.every((item) => item.indent === 0) && items.some((item) => item.numberDepth !== undefined);

    if (numbering) {
        const parents: TodoInput[] = [];
        for (const item of items) {
            const node: TodoInput = { title: cleanTitle(item.text) };
            const depth = item.numberDepth ?? 0;
            const parent = depth > 0 ? parents[depth - 1] : undefined;
            if (parent) (parent.subtasks ??= []).push(node);
            else roots.push(node);
            parents[depth] = node;
            parents.length = depth + 1;
        }
        return roots;
    }

    const stack: { indent: number; node: TodoInput }[] = [];
    for (const item of items) {
        while (stack.length && item.indent <= stack[stack.length - 1]!.indent) stack.pop();
        const node: TodoInput = { title: cleanTitle(item.text) };
        const parent = stack[stack.length - 1]?.node;
        if (parent) (parent.subtasks ??= []).push(node);
        else roots.push(node);
        stack.push({ indent: item.indent, node });
    }
    return roots;
}

/**
 * Plans from the model may arrive in different shapes: JSON string, single object,
 * indented outline, or {name, children} instead of {title, subtasks}. Normalize all forms.
 */
export function normalizeTree(raw: unknown): TodoInput[] {
    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) throw new Error("tasks is empty");
        if (s.startsWith("[") || s.startsWith("{")) {
            try {
                raw = JSON.parse(s);
            } catch {
                throw new Error("tasks must be a JSON array of {title, subtasks?}");
            }
        } else {
            return parseOutline(raw);
        }
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) raw = [raw];
    if (!Array.isArray(raw)) throw new Error("tasks must be an array of {title, subtasks?}");
    if (!raw.length) throw new Error("tasks is empty");

    return raw.map((item, i) => {
        if (typeof item === "string") return { title: cleanTitle(item) };
        if (!item || typeof item !== "object") throw new Error(`task ${i + 1} must be an object or string`);

        const o = item as Record<string, unknown>;
        if (o.title === undefined && o.name === undefined) throw new Error(`task ${i + 1} is missing title`);
        const nested = o.subtasks ?? o.children ?? o.tasks;
        return {
            title: cleanTitle(o.title ?? o.name),
            notes: cleanNotes(o.notes),
            subtasks: nested === undefined ? undefined : normalizeTree(nested),
        };
    });
}

/**
 * In-memory task tree. IDs are hierarchical ("1", "1.2", "1.2.3") so the model
 * ko parent/child references dene me confusion na ho.
 */
export class TodoStore {
    private tasks = new Map<string, Todo>();
    private roots: string[] = [];

    get size() {
        return this.tasks.size;
    }

    add(input: TodoInput | string, parentId?: string): Todo {
        const item: TodoInput = typeof input === "string" ? { title: input } : input;
        const title = cleanTitle(item.title);
        const parent = parentId ? this.get(parentId) : undefined;
        const id = this.nextId(parentId);
        const todo: Todo = { id, title, status: "pending", children: [] };

        if (parent) todo.parentId = parent.id;
        const notes = cleanNotes(item.notes);
        if (notes) todo.notes = notes;

        this.tasks.set(id, todo);
        if (parent) parent.children.push(id);
        else this.roots.push(id);

        for (const child of item.subtasks ?? []) this.add(child, id);
        return todo;
    }

    get(id: string): Todo {
        const key = String(id ?? "").trim();
        const todo = this.tasks.get(key);
        if (!todo) throw new Error(`unknown task id: ${key || "(empty)"}`);
        return todo;
    }

    has(id: string): boolean {
        return this.tasks.has(String(id ?? "").trim());
    }

    setStatus(id: string, status: TodoStatus): Todo {
        if (!isTodoStatus(status)) throw new Error(`invalid status: ${String(status)}`);
        const todo = this.get(id);
        todo.status = status;

        this.markAncestorsInProgress(todo);
        if (status === "done") this.completeAncestors(todo);
        return todo;
    }

    update(id: string, patch: { title?: unknown; notes?: unknown; status?: unknown }): Todo {
        const todo = this.get(id);
        if (patch.title !== undefined) todo.title = cleanTitle(patch.title);

        if (patch.notes !== undefined) {
            const notes = cleanNotes(patch.notes);
            if (notes) todo.notes = notes;
            else delete todo.notes;
        }

        if (patch.status !== undefined) {
            if (!isTodoStatus(patch.status)) throw new Error(`invalid status: ${String(patch.status)}`);
            this.setStatus(id, patch.status);
        }
        return todo;
    }

    /** Remove a task and its subtree. Returns the number of tasks removed. */
    remove(id: string): number {
        const todo = this.get(id);
        let removed = 0;
        for (const child of [...todo.children]) removed += this.remove(child);

        this.tasks.delete(id);
        removed++;

        const siblings = todo.parentId ? this.get(todo.parentId).children : this.roots;
        const at = siblings.indexOf(id);
        if (at >= 0) siblings.splice(at, 1);

        if (todo.parentId) {
            const parent = this.tasks.get(todo.parentId);
            if (parent?.status === "done") parent.status = parent.children.length ? "in_progress" : "pending";
        }
        return removed;
    }

    clear() {
        this.tasks.clear();
        this.roots = [];
    }

    /** First actionable leaf in DFS order. Blocked leaves are skipped. */
    next(): Todo | undefined {
        const walk = (ids: string[]): Todo | undefined => {
            for (const id of ids) {
                const todo = this.tasks.get(id);
                if (!todo || todo.status === "blocked") continue;
                if (todo.children.length) {
                    const found = walk(todo.children);
                    if (found) return found;
                } else if (todo.status !== "done") {
                    return todo;
                }
            }
            return undefined;
        };
        return walk(this.roots);
    }

    stats() {
        const all = [...this.tasks.values()];
        return {
            total: all.length,
            done: all.filter((t) => t.status === "done").length,
            blocked: all.filter((t) => t.status === "blocked").length,
            pending: all.filter((t) => t.status === "pending").length,
            inProgress: all.filter((t) => t.status === "in_progress").length,
        };
    }

    render(maxChars = 12_000): string {
        if (!this.roots.length) return "(no tasks)";

        const lines: string[] = [];
        const walk = (ids: string[], depth: number) => {
            for (const id of ids) {
                const todo = this.tasks.get(id);
                if (!todo) continue;
                const pad = "  ".repeat(depth);
                const note = todo.notes ? ` — ${todo.notes}` : "";
                lines.push(`${pad}${todo.id} ${MARK[todo.status]} ${todo.title}${note}`);
                walk(todo.children, depth + 1);
            }
        };
        walk(this.roots, 0);

        const { done, total } = this.stats();
        const head = `${done}/${total} done`;
        const body = lines.join("\n");
        return body.length > maxChars ? `${head}\n${body.slice(0, maxChars)}\n... (truncated)` : `${head}\n${body}`;
    }

    private nextId(parentId?: string): string {
        const siblings = parentId ? this.get(parentId).children : this.roots;
        const prefix = parentId ? `${parentId}.` : "";
        let max = 0;
        for (const id of siblings) {
            const n = Number(id.slice(prefix.length).split(".")[0]);
            if (Number.isInteger(n)) max = Math.max(max, n);
        }
        return `${prefix}${max + 1}`;
    }

    /** Child start/done pe ancestors ka status current rakho. */
    private markAncestorsInProgress(todo: Todo) {
        let parentId = todo.parentId;
        while (parentId) {
            const parent = this.tasks.get(parentId);
            if (!parent) break;
            if (parent.status !== "in_progress") parent.status = "in_progress";
            parentId = parent.parentId;
        }
    }

    /** Saare children done ho gaye to parent bhi done. */
    private completeAncestors(todo: Todo) {
        let parentId = todo.parentId;
        while (parentId) {
            const parent = this.tasks.get(parentId);
            if (!parent) break;
            if (!parent.children.every((id) => this.tasks.get(id)?.status === "done")) break;
            parent.status = "done";
            parentId = parent.parentId;
        }
    }
}
