export type Lang = "js" | "py" | "c" | "go" | "other";

export interface DocRequest {
    name: string;
    lang: Lang;
    topic?: string;
}

export interface DocPage {
    source: string; // "installed package", "PyPI", "web"...
    location: string; // path ya URL
    text: string;
    hint?: string; // where the model should look next
    thin?: boolean; // metadata only (no README): try the next source; return this if nothing else is found
}

/**
 * Docs ka ek source (local package, system headers, registry, web...).
 * If find() returns null, try the next source. Thrown errors also fall through to the next source.
 */
export abstract class DocSource {
    abstract readonly label: string;
    abstract supports(lang: Lang): boolean;
    abstract find(req: DocRequest, signal: AbortSignal): Promise<DocPage | null>;
}

export const MAX_DOC_CHARS = 8_000;
const INTRO_CHARS = 1_500;
const SECTION_CHARS = 2_500;

const LANGS: Record<string, Lang> = {
    js: "js", javascript: "js", ts: "js", typescript: "js", node: "js", nodejs: "js", bun: "js", jsx: "js", tsx: "js",
    py: "py", python: "py", python3: "py",
    c: "c", cpp: "c", "c++": "c", cxx: "c", cc: "c", "c/c++": "c",
    go: "go", golang: "go",
};

export function normalizeLang(raw: unknown): Lang {
    return LANGS[String(raw ?? "").toLowerCase().trim()] ?? "other";
}

/** Name is used in commands/paths, so validate strictly: no flags, "..", or unusual characters. */
export function validateName(raw: unknown): string {
    const n = String(raw ?? "").trim().replace(/^<|>$/g, "").replace(/^std::/, "");
    if (!n) throw new Error("name is empty");
    if (!/^[A-Za-z0-9@][A-Za-z0-9@_.+\/-]*$/.test(n) || n.includes("..")) throw new Error(`invalid name: ${n}`);
    return n;
}

import { spawn } from "node:child_process";

/**
 * Command chalao aur uska output lo. Command na mile ya crash ho to null.
 * A non-zero exit code can still be a valid result — callers decide how to handle it.
 */
export async function runCmd(
    cmd: string[],
    opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ out: string; code: number } | null> {
    return await new Promise((resolve) => {
        let child;
        try {
            child = spawn(cmd[0]!, cmd.slice(1), {
                cwd: opts.cwd,
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, ...opts.env },
            });
        } catch {
            return resolve(null);
        }

        let out = "";
        let finished = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (value: { out: string; code: number } | null) => {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            resolve(value);
        };

        timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 8_000);
        child.stdout?.on("data", (chunk) => {
            out += String(chunk);
        });
        child.stderr?.on("data", () => {
            // drain: do not let the buffer fill; output is not needed
        });
        child.on("error", () => finish(null)); // command is not installed
        child.on("close", (code) => finish({ out, code: code ?? -1 }));
    });
}

// markdown heading ya man/pydoc style ALL-CAPS heading (NAME, SYNOPSIS, DESCRIPTION...)
const HEADING = /^(#{1,4} .+|[A-Z][A-Z ]{3,})$/;

/**
 * For large docs: keep the intro plus sections that best match the topic (in original order).
 * If no topic is provided or nothing matches, return the beginning.
 */
export function extractRelevant(text: string, topic: string | undefined, max = MAX_DOC_CHARS): string {
    const t = text.trim();
    if (t.length <= max) return t;
    const note = `\n...[truncated, ${t.length} chars total]`;
    const words = (topic ?? "").toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 2);

    const sections: string[] = [];
    let cur: string[] = [];
    for (const line of t.split("\n")) {
        if (HEADING.test(line) && cur.length) {
            sections.push(cur.join("\n"));
            cur = [];
        }
        cur.push(line);
    }
    if (cur.length) sections.push(cur.join("\n"));

    if (!words.length || sections.length < 2) return t.slice(0, max - note.length) + note;

    const score = (s: string) => {
        const low = s.toLowerCase();
        return words.reduce((n, w) => n + low.split(w).length - 1, 0);
    };
    const ranked = sections
        .map((s, i) => ({ i, score: score(s) }))
        .filter((x) => x.i > 0 && x.score > 0)
        .sort((a, b) => b.score - a.score);

    const chosen = new Set<number>([0]);
    let used = Math.min(sections[0]!.length, INTRO_CHARS);
    for (const { i } of ranked) {
        const len = Math.min(sections[i]!.length, SECTION_CHARS);
        if (used + len > max - note.length) continue;
        chosen.add(i);
        used += len;
    }
    if (chosen.size === 1) return t.slice(0, max - note.length) + note; // no topic match found

    return (
        [...chosen]
            .sort((a, b) => a - b)
            .map((i) => sections[i]!.slice(0, i === 0 ? INTRO_CHARS : SECTION_CHARS))
            .join("\n\n[...]\n\n") + note
    );
}