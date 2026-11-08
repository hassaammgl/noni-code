import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../util/Fs";

/** Where a skill came from — the index includes only name/description; source is for debugging. */
export type SkillSource = "builtin" | "global" | "project" | "custom";

export interface Skill {
    name: string;
    description: string;
    body: string;
    source: SkillSource;
    path: string;
}

/** Ek skill ka max size; bada file context na uda de. */
const MAX_BODY_CHARS = 24_000;
const MAX_DESCRIPTION_CHARS = 240;
const MAX_DEPTH = 4;

/** Built-in skills ship with the package: <package>/.ai/skills */
const BUILTIN_DIR = fileURLToPath(new URL("../../.ai/skills", import.meta.url));

function configBase(): string {
    return process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
}

function unquote(value: string): string {
    return value.trim().replace(/^["']|["']$/g, "");
}

/** Frontmatter (`--- name/description ---`) padho; na ho to filename se naam, pehli line se description. */
export function parseSkill(raw: string, fallbackName: string): Omit<Skill, "source" | "path"> | null {
    let body = raw.replace(/^\uFEFF/, "").trim();
    let name = fallbackName;
    let description = "";

    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
    if (front) {
        body = body.slice(front[0].length).trim();
        for (const line of front[1]!.split(/\r?\n/)) {
            const m = /^(name|description)\s*:\s*(.+)$/i.exec(line.trim());
            if (!m) continue;
            if (m[1]!.toLowerCase() === "name") name = unquote(m[2]!);
            else description = unquote(m[2]!);
        }
    }

    if (!description) {
        description =
            body
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line && !line.startsWith("#")) ?? "";
    }

    name = name.trim();
    if (!name || !body) return null;

    return {
        name,
        description: description.replace(/\s+/g, " ").slice(0, MAX_DESCRIPTION_CHARS),
        body: body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n\n…(truncated)` : body,
    };
}

/** `<name>/SKILL.md` ka naam folder se; baaki ke liye filename se. */
function nameOf(file: string): string {
    const base = basename(file);
    if (/^skill\.md$/i.test(base)) return basename(dirname(file));
    return base.slice(0, -extname(base).length);
}

/** Folder ke andar saare `.md` skills dhundo (README aur hidden files skip). */
async function walk(dir: string, out: string[], depth = 0): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return; // no error if the folder is missing
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            await walk(full, out, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            if (entry.name.toLowerCase() === "readme.md") continue;
            out.push(full);
        }
    }
}

/**
 * Skills = markdown instruction packs. The index goes into the system prompt; full body loads only
 * via the `skill` tool. This keeps the persona small and saves context.
 *
 * Priority (later wins): builtin → global → project → NONI_SKILLS_DIR.
 */
export class SkillStore {
    private skills = new Map<string, Skill>();

    constructor(private cwd: string) {}

    private roots(): { dir: string; source: SkillSource }[] {
        const global = join(configBase(), "noni-chan", ".ai");
        const project = join(this.cwd, ".ai");
        const roots: { dir: string; source: SkillSource }[] = [
            { dir: BUILTIN_DIR, source: "builtin" },
            { dir: join(global, "skills"), source: "global" },
            { dir: global, source: "global" },
            { dir: join(project, "skills"), source: "project" },
            { dir: project, source: "project" },
        ];

        for (const dir of (process.env.NONI_SKILLS_DIR ?? "").split(delimiter)) {
            const clean = dir.trim().replace(/^~(?=$|\/)/, homedir());
            if (clean) roots.push({ dir: clean, source: "custom" });
        }
        return roots;
    }

    /** Reload from disk. Replaces the current list. */
    async load(): Promise<Skill[]> {
        const merged = new Map<string, Skill>();

        for (const root of this.roots()) {
            const files: string[] = [];
            await walk(root.dir, files);

            for (const file of files) {
                let raw: string;
                try {
                    raw = await readText(file);
                } catch {
                    continue;
                }
                const parsed = parseSkill(raw, nameOf(file));
                if (!parsed) continue;
                merged.set(parsed.name.toLowerCase(), { ...parsed, source: root.source, path: file });
            }
        }

        this.skills = merged;
        return this.list();
    }

    list(): Skill[] {
        return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    get(name: string): Skill | null {
        const key = String(name ?? "")
            .trim()
            .toLowerCase()
            .replace(/^\.?ai\/skills?\//, "")
            .replace(/\/skill\.md$/, "")
            .replace(/\.md$/, "");
        return this.skills.get(key) ?? null;
    }

    names(): string[] {
        return this.list().map((s) => s.name);
    }

    /** Only this compact index goes into the system prompt. */
    renderIndex(): string {
        return this.list()
            .map((s) => `- ${s.name}: ${s.description || "(no description)"}`)
            .join("\n");
    }

    renderList(): string {
        return this.list()
            .map((s) => `${s.name}  —  ${s.description || "(no description)"}  [${s.source}]`)
            .join("\n");
    }

    /** Skill folders being scanned (debug / `/skills where`). */
    locations(): string[] {
        return this.roots().map((r) => `${r.source}: ${r.dir}`);
    }
}
