import { isTodoStatus, normalizeTree, parseOutline, type TodoStore } from "../todos/TodoStore";
import { Tool } from "./Tool";

const ACTIONS = ["plan", "add", "list", "update", "done", "next", "remove", "clear"] as const;

function requireId(raw: unknown): string {
    const id = String(raw ?? "").trim();
    if (!id) throw new Error("id is required for this action (e.g. \"1\" or \"1.2\")");
    return id;
}

/**
 * Agent planner. Break large work into a nested plan, then next -> work -> done.
 * This tool only manages state; actual work is done by other tools.
 */
export class TodoTool extends Tool {
    name = "todo";
    description =
        "Manage a hierarchical task plan. For multi-step work, first create a nested plan, then work one leaf at a time. " +
        "Actions: plan (replace the plan using `outline` indented text or `tasks` array), add (one task or subtask), " +
        "next (claim the next leaf and mark it in_progress), done (mark a task done), update (title/notes/status), list, remove, clear. " +
        "Easiest plan format: outline=\"1. Build\\n  1.1 API\\n  1.2 UI\\n2. Test\". " +
        "Use next -> do the work with other tools -> done, and add new subtasks when you discover them.";
    parameters = {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [...ACTIONS],
                description: "What to do. Start with action=plan for multi-step work.",
            },
            outline: {
                type: "string",
                description:
                    "For action=plan: indented text plan, easiest for small models. " +
                    "Two spaces = subtask. Example: \"1. Build login\\n  1.1 HTML form\\n  1.2 Validation\\n2. Test\".",
            },
            replace: {
                type: "boolean",
                description: "For action=plan: true to replace an existing plan. Default false, so an accidental re-plan cannot wipe progress.",
            },
            tasks: {
                type: "array",
                description: "For action=plan: nested tree (alternative to outline). Each item is {title, notes?, subtasks?: [{title, ...}]}.",
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        notes: { type: "string" },
                        subtasks: {
                            type: "array",
                            description: "Nested subtasks, same shape.",
                            items: { type: "object" },
                        },
                    },
                    required: ["title"],
                },
            },
            id: { type: "string", description: "Task id, e.g. \"1\" or \"1.2.1\"." },
            parent_id: { type: "string", description: "For action=add: parent task id. Omit for a top-level task." },
            title: { type: "string", description: "Task title for action=add/update." },
            notes: { type: "string", description: "Optional detail for action=add/update." },
            status: {
                type: "string",
                enum: ["pending", "in_progress", "done", "blocked"],
                description: "For action=update: new status.",
            },
        },
        required: ["action"],
    };

    constructor(private store: TodoStore) {
        super();
    }

    async run(args: Record<string, any>) {
        const rawAction = String(args.action ?? "").trim().toLowerCase();
        // If a small model omits action, infer it from the payload shape
        const action =
            rawAction ||
            (args.tasks !== undefined || args.outline !== undefined ? "plan" : args.title !== undefined ? "add" : "list");

        switch (action) {
            case "plan": {
                const outline = args.outline === undefined ? "" : String(args.outline).trim();
                if (args.tasks === undefined && !outline) {
                    throw new Error(
                        "action=plan needs `outline` (indented text) or `tasks` (nested array). " +
                            'Example: outline="1. Build\\n  1.1 API\\n  1.2 UI\\n2. Test"',
                    );
                }
                const replace = args.replace === true || String(args.replace).toLowerCase() === "true";
                if (this.store.size && !replace) {
                    throw new Error(
                        `A plan already exists (${this.store.size} tasks). Use action=add for new tasks, ` +
                            "or action=plan with replace=true to intentionally replace it.",
                    );
                }
                const tree = outline && args.tasks === undefined ? parseOutline(outline) : normalizeTree(args.tasks);
                this.store.clear();
                for (const task of tree) this.store.add(task);
                return `Plan saved (${this.store.size} tasks).\n${this.store.render()}\n${this.progress()}`;
            }

            case "add": {
                if (args.title === undefined) {
                    throw new Error(
                        "action=add needs `title` for one task. " +
                            "To work through the saved plan, call action=next instead of re-adding it.",
                    );
                }
                const parentId = args.parent_id ? String(args.parent_id).trim() : undefined;
                const subtasks = args.tasks !== undefined ? normalizeTree(args.tasks) : undefined;
                const todo = this.store.add(
                    { title: String(args.title), notes: args.notes ? String(args.notes) : undefined, subtasks },
                    parentId,
                );
                return `Added ${todo.id} "${todo.title}"${todo.parentId ? ` under ${todo.parentId}` : ""}.\n${this.progress()}`;
            }

            case "list":
                return this.store.render();

            case "next": {
                const todo = this.store.next();
                if (!todo) {
                    const s = this.store.stats();
                    if (!s.total) return "No tasks yet. Create a plan with action=plan.";
                    if (s.blocked) return `No actionable task. ${s.blocked} blocked, ${s.done}/${s.total} done. Use action=list.`;
                    return `All tasks done (${s.done}/${s.total}).`;
                }
                this.store.setStatus(todo.id, "in_progress");
                const notes = todo.notes ? `\nNotes: ${todo.notes}` : "";
                return `Next: ${todo.id} "${todo.title}" (in_progress)${notes}\n${this.progress()}`;
            }

            case "done": {
                const todo = this.store.get(requireId(args.id));
                this.store.setStatus(todo.id, "done");
                return `Done ${todo.id} "${todo.title}".\n${this.progress()}`;
            }

            case "update": {
                const id = requireId(args.id);
                if (!isTodoStatus(args.status) && args.title === undefined && args.notes === undefined) {
                    throw new Error("action=update needs status, title or notes");
                }
                const todo = this.store.update(id, { title: args.title, notes: args.notes, status: args.status });
                return `Updated ${todo.id} "${todo.title}" (${todo.status}).\n${this.progress()}`;
            }

            case "remove": {
                const id = requireId(args.id);
                const removed = this.store.remove(id);
                return `Removed ${removed} task${removed === 1 ? "" : "s"}.\n${this.progress()}`;
            }

            case "clear":
                this.store.clear();
                return "Todo plan cleared.";

            default:
                throw new Error(`unknown action: ${action || "(empty)"}. Use one of: ${ACTIONS.join(", ")}`);
        }
    }

    private progress() {
        const s = this.store.stats();
        const next = this.store.next();
        const tail = next
            ? `Next step: call todo {"action":"next"} for ${next.id} "${next.title}".`
            : s.total
              ? `All ${s.total} tasks done.`
              : "";
        return `Progress: ${s.done}/${s.total} done, ${s.blocked} blocked.${tail ? ` ${tail}` : ""}`;
    }
}
