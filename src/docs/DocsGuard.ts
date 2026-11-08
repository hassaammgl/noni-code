import { stat } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, extname, join } from "node:path";
import type { Guard } from "../agent/Agent";
import type { Tool } from "../tools/Tool";
import { runCmd } from "./DocSource";
import { readText } from "../util/Fs";

/** Libraries whose docs have been read in this session (reset on /clear). */
export class DocsRegistry {
    private read = new Set<string>();
    mark(name: string) {
        this.read.add(name.toLowerCase());
    }
    has(name: string) {
        return this.read.has(name.toLowerCase());
    }
    clear() {
        this.read.clear();
    }
}

type Lang = "js" | "py";

// C/C++ (.c .cpp .h ...) and other extensions are not listed here, so they are unchecked
const EXT_LANG: Record<string, Lang> = {
    ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".mts": "js", ".cts": "js",
    ".py": "py",
};

// file likhne/badalne wale tools: naya code (after) aur purana (before) kahan se milega
type GuardPair = { before: string; after: string };
const GUARDED: Record<string, (a: Record<string, any>, root: string) => GuardPair | Promise<GuardPair>> = {
    write_file: (a) => ({ before: "", after: String(a.content ?? "") }),
    edit_file: (a) => ({ before: String(a.old_string ?? ""), after: String(a.new_string ?? "") }),
    // replace_lines needs the file's existing lines; otherwise pre-existing imports look "new"
    replace_lines: async (a, root) => ({
        before: await linesInRange(root, String(a.path ?? ""), Number(a.start_line), Number(a.end_line)),
        after: String(a.new_content ?? ""),
    }),
};

/** Existing file lines for replace_lines (the guard needs the before state). */
async function linesInRange(root: string, path: string, start: number, end: number): Promise<string> {
    if (!path || !Number.isInteger(start) || start < 1 || !Number.isInteger(end)) return "";
    try {
        const lines = (await readText(join(root, path))).split("\n");
        return lines.slice(start - 1, Math.max(start - 1, end)).join("\n");
    } catch {
        return ""; // file not found: treat like write_file
    }
}

const JS_BUILTINS = new Set([...builtinModules.map((m) => m.split("/")[0]!), "bun"]);
const MAX_BLOCKS = 2; // ek package pe itni baar roko, phir jane do (agar model name galat de raha ho to deadlock na ho)

function jsPackages(code: string): Set<string> {
    const out = new Set<string>();
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (/^([./#~]|@\/|node:|bun:)/.test(spec)) continue; // relative, alias, builtin
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
        if (!JS_BUILTINS.has(name)) out.add(name);
    }
    return out;
}

function pyModules(code: string): Set<string> {
    const out = new Set<string>();
    for (const m of code.matchAll(/^[ \t]*from[ \t]+([A-Za-z_]\w*)[\w.]*[ \t]+import\b/gm)) out.add(m[1]!);
    for (const m of code.matchAll(/^[ \t]*import[ \t]+([^\n#;]+)/gm)) {
        for (const part of m[1]!.split(",")) {
            const top = part.trim().split(/\s+as\s+/)[0]!.split(".")[0]!.trim();
            if (/^[A-Za-z_]\w*$/.test(top)) out.add(top);
        }
    }
    return out;
}

async function exists(p: string): Promise<boolean> {
    try {
        await stat(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Models often forget prompt rules, so this is enforced in code:
 * Writing a JS/TS/Python file with a third-party import whose docs were not read via read_docs -> Blocked.
 * C/C++ and other languages are exempt. Only import lines are detected (not bare `lib.fn()` usage).
 */
export class DocsGuard implements Guard {
    private blocks = new Map<string, number>();
    private pyStdlib?: Promise<Set<string> | null>;

    constructor(
        private docs: DocsRegistry,
        private root: string,
    ) { }

    reset() {
        this.docs.clear();
        this.blocks.clear();
    }

    async check(tool: Tool, args: Record<string, any>): Promise<string | undefined> {
        const pick = GUARDED[tool.name];
        if (!pick) return;
        const path = String(args.path ?? "");
        const lang = EXT_LANG[extname(path).toLowerCase()];
        if (!lang) return;

        const { before, after } = await pick(args, this.root);
        const used = await this.packages(lang, after, path);
        const already = await this.packages(lang, before, path); // imports present before the edit are not new
        const missing = [...used].filter(
            (p) => !already.has(p) && !this.docs.has(p) && (this.blocks.get(p) ?? 0) < MAX_BLOCKS,
        );
        if (!missing.length) return;

        for (const p of missing) this.blocks.set(p, (this.blocks.get(p) ?? 0) + 1);
        const lname = lang === "js" ? "js" : "python";
        return (
            `Blocked: this code uses ${missing.map((p) => `"${p}"`).join(", ")} but you have not read the docs yet. ` +
            `First call read_docs for each, e.g. read_docs {"name":"${missing[0]}","language":"${lname}"}, then retry this edit. ` +
            `If no docs exist, read_docs will say so and you may continue.`
        );
    }

    private async packages(lang: Lang, code: string, filePath: string): Promise<Set<string>> {
        if (lang === "js") return jsPackages(code);

        const mods = pyModules(code);
        const stdlib = await this.stdlib();
        if (!stdlib) return new Set(); // python3 unavailable: skip Python stdlib check
        const out = new Set<string>();
        for (const m of mods) {
            if (stdlib.has(m)) continue;
            const here = [this.root, dirname(join(this.root, filePath))];
            const local = await Promise.all(here.flatMap((d) => [exists(join(d, `${m}.py`)), exists(join(d, m))]));
            if (!local.some(Boolean)) out.add(m); // not a local module, so treat as third-party
        }
        return out;
    }

    private stdlib(): Promise<Set<string> | null> {
        this.pyStdlib ??= runCmd(["python3", "-c", "import sys;print(' '.join(sys.stdlib_module_names))"]).then((r) =>
            r && r.code === 0 && r.out.trim() ? new Set(r.out.trim().split(/\s+/)) : null,
        );
        return this.pyStdlib;
    }
}