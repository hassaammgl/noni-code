import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { Tool } from "./Tool";

/** Small content preview for confirm prompts, not the full file. */
function snippet(value: unknown, maxLines = 8): string {
    const lines = String(value ?? "").split("\n");
    const shown = lines.slice(0, maxLines);
    const more = lines.length - shown.length;
    return shown.map((line) => `  ${line}`).join("\n") + (more > 0 ? `\n  … +${more} lines` : "");
}

/** Whether a path exists (file or folder). */
async function exists(p: string): Promise<boolean> {
    try {
        await stat(p);
        return true;
    } catch {
        return false;
    }
}

/** Base class: all file tools stay inside the workspace. */
abstract class FileTool extends Tool {
    constructor(private root: string) {
        super();
    }
    protected path(p: string = "."): string {
        const abs = resolve(this.root, p);
        if (relative(this.root, abs).startsWith("..")) throw new Error(`outside workspace: ${p}`);
        return abs;
    }
}

export class ReadFileTool extends FileTool {
    name = "read_file";
    description = "Read a file and return its content with line numbers";
    parameters = {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
    };
    async run({ path }: Record<string, any>) {
        const text = await readFile(this.path(path), "utf8");
        return text.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");
    }
}

export class ListDirTool extends FileTool {
    name = "list_dir";
    description = "List files and folders in a directory";
    parameters = { type: "object", properties: { path: { type: "string" } } };
    async run({ path }: Record<string, any>) {
        const items = await readdir(this.path(path), { withFileTypes: true });
        return items.map((e) => e.name + (e.isDirectory() ? "/" : "")).join("\n") || "(empty)";
    }
}

export class WriteFileTool extends FileTool {
    name = "write_file";
    description = "Create a file or overwrite it with the given content";
    parameters = {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
    };
    override dangerous = true;
    override preview({ path, content }: Record<string, any>) {
        return `write ${path}\n${snippet(content)}`;
    }
    async run({ path, content }: Record<string, any>) {
        await writeFile(this.path(path), content, "utf8");
        return `wrote ${path}`;
    }
}

export class EditFileTool extends FileTool {
    name = "edit_file";
    description = "Replace old_string with new_string in a file (old_string must be unique)";
    parameters = {
        type: "object",
        properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
        required: ["path", "old_string", "new_string"],
    };
    override dangerous = true;
    override preview({ path, old_string, new_string }: Record<string, any>) {
        return `edit ${path}\n${snippet(`- ${old_string}\n+ ${new_string}`, 10)}`;
    }
    async run({ path, old_string, new_string }: Record<string, any>) {
        const file = this.path(path);
        const text = await readFile(file, "utf8");
        const count = text.split(old_string).length - 1;
        if (count !== 1) throw new Error(`old_string found ${count} times, need exactly 1`);
        await writeFile(file, text.replace(old_string, () => new_string), "utf8");
        return `edited ${path}`;
    }
}

export class ReplaceLinesTool extends FileTool {
    name = "replace_lines";
    description =
        "Replace lines start_line..end_line (1-based, inclusive) of a file with new_content. " +
        "Empty new_content deletes those lines; keep end_line = start_line - 1 to insert without deleting";
    parameters = {
        type: "object",
        properties: {
            path: { type: "string" },
            start_line: { type: "number", description: "First line to replace (1-based)" },
            end_line: { type: "number", description: "Last line to replace (inclusive); start_line - 1 = pure insert" },
            new_content: { type: "string", description: "Replacement text; empty string deletes the lines" },
        },
        required: ["path", "start_line", "end_line", "new_content"],
    };
    override dangerous = true;
    override preview({ path, start_line, end_line, new_content }: Record<string, any>) {
        const start = Number(start_line);
        const end = Number(end_line);
        const count = end - start + 1;
        const head =
            count > 0 ? `replace lines ${start}-${end} (${count}) in ${path}` : `insert at line ${start} in ${path}`;
        const content = String(new_content ?? "");
        return `${head}\n${content ? snippet(content, 10) : "  (delete lines)"}`;
    }
    async run({ path, start_line, end_line, new_content }: Record<string, any>) {
        const file = this.path(path);
        const text = await readFile(file, "utf8");
        const trailingNewline = text.endsWith("\n");
        const lines = text.split("\n");
        if (trailingNewline) lines.pop(); // aakhri khali element line count me na aaye

        const start = Number(start_line);
        const end = Number(end_line);
        if (!Number.isInteger(start) || start < 1) throw new Error(`start_line must be >= 1 (got: ${start_line})`);
        if (!Number.isInteger(end)) throw new Error(`end_line must be an integer (got: ${end_line})`);
        if (start > lines.length + 1) throw new Error(`start_line ${start} is past the end of the file (${lines.length} lines total)`);
        if (end > lines.length) throw new Error(`end_line ${end} is past the end of the file (${lines.length} lines total)`);
        if (end < start - 1) throw new Error(`end_line ${end} is before start_line ${start}`);

        const raw = String(new_content ?? "");
        const replacement = raw === "" ? [] : (raw.endsWith("\n") ? raw.slice(0, -1) : raw).split("\n");
        const out = [...lines.slice(0, start - 1), ...replacement, ...lines.slice(end)];
        await writeFile(file, out.join("\n") + (trailingNewline ? "\n" : ""), "utf8");

        const done = end < start ? `inserted ${replacement.length} line(s) at ${start}` : `replaced lines ${start}-${end}`;
        return `${done} in ${path}`;
    }
}

export class MoveFileTool extends FileTool {
    name = "move_file";
    description = "Rename or move a file/folder inside the workspace; missing parent folders are created, existing destination is not overwritten";
    parameters = {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
    };
    override dangerous = true;
    override preview({ from, to }: Record<string, any>) {
        return `move ${from} → ${to}`;
    }
    async run({ from, to }: Record<string, any>) {
        const src = this.path(from);
        const dst = this.path(to);
        if (src === dst) throw new Error("from and to are the same path");
        if (!(await exists(src))) throw new Error(`source not found: ${from}`);
        if (await exists(dst)) throw new Error(`destination already exists: ${to}`);

        await mkdir(dirname(dst), { recursive: true });
        await rename(src, dst);
        return `moved ${from} → ${to}`;
    }
}

export class MakeDirTool extends FileTool {
    name = "make_dir";
    description = "Create a folder (and missing parents) inside the workspace";
    parameters = {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
    };
    override dangerous = true;
    override preview({ path }: Record<string, any>) {
        return `mkdir ${path}`;
    }
    async run({ path }: Record<string, any>) {
        const dir = this.path(path);
        if (await exists(dir)) throw new Error(`already exists: ${path}`);
        await mkdir(dir, { recursive: true });
        return `created ${path}/`;
    }
}

export class DeleteFileTool extends FileTool {
    name = "delete_file";
    description = "Delete a file";
    parameters = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
    override dangerous = true;
    override preview({ path }: Record<string, any>) {
        return `delete ${path}`;
    }
    async run({ path }: Record<string, any>) {
        await rm(this.path(path));
        return `deleted ${path}`;
    }
}