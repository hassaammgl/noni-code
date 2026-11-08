import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DocSource, extractRelevant, MAX_DOC_CHARS, runCmd, type DocPage, type DocRequest, type Lang } from "./DocSource";
import { exists, readJson, readText } from "../util/Fs";

/** JS/TS: project ke node_modules me installed package ka README + type definitions ka pata */
export class NodeModulesSource extends DocSource {
    readonly label = "installed package";

    constructor(private root: string) {
        super();
    }

    supports(lang: Lang) {
        return lang === "js";
    }

    async find({ name, topic }: DocRequest): Promise<DocPage | null> {
        const dir = join(this.root, "node_modules", name);
        const pkgPath = join(dir, "package.json");
        if (!(await exists(pkgPath))) return null;
        const pkg = await readJson<Record<string, any>>(pkgPath);

        let readme = "";
        for (const f of ["README.md", "readme.md", "Readme.md", "README.markdown", "README"]) {
            const file = join(dir, f);
            if (await exists(file)) {
                readme = await readText(file);
                break;
            }
        }

        const types: string | undefined =
            pkg.types ?? pkg.typings ?? ((await exists(join(dir, "index.d.ts"))) ? "index.d.ts" : undefined);

        return {
            source: "installed package",
            location: `node_modules/${name}`,
            text: extractRelevant(`# ${pkg.name}@${pkg.version}\n${pkg.description ?? ""}\n\n${readme || "(package has no README)"}`, topic),
            hint: [
                types && `Exact signatures: node_modules/${name}/${String(types).replace(/^\.\//, "")} (use grep / read_file on it)`,
                pkg.homepage && `Homepage: ${pkg.homepage}`,
            ]
                .filter(Boolean)
                .join("\n"),
        };
    }
}

const HEADER_DIRS = ["/usr/include", "/usr/local/include", "/usr/include/x86_64-linux-gnu", "/usr/include/aarch64-linux-gnu"];

async function isFile(p: string): Promise<boolean> {
    try {
        return (await stat(p)).isFile();
    } catch {
        return false;
    }
}

async function findHeader(name: string): Promise<string | null> {
    const dirs = [...HEADER_DIRS];
    try {
        const versions = (await readdir("/usr/include/c++")).sort().reverse();
        for (const v of versions) dirs.push(`/usr/include/c++/${v}`);
    } catch { }
    for (const d of dirs) {
        for (const n of [name, `${name}.h`, `${name}.hpp`]) {
            const p = join(d, n);
            if (await isFile(p)) return p;
        }
    }
    return null;
}

/** topic wali lines + aas paas ka context (header files ke liye) */
function grepContext(text: string, topic: string, ctx = 3, max = MAX_DOC_CHARS): string | null {
    const re = new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const lines = text.split("\n");
    const keep = new Set<number>();
    lines.forEach((l, i) => {
        if (re.test(l)) for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep.add(k);
    });
    if (!keep.size) return null;
    const out: string[] = [];
    let prev = -2;
    for (const i of [...keep].sort((a, b) => a - b)) {
        if (i !== prev + 1) out.push("...");
        out.push(`${i + 1}: ${lines[i]}`);
        prev = i;
    }
    const s = out.join("\n");
    return s.length > max ? s.slice(0, max) + "\n...[truncated]" : s;
}

/**
 * Uses docs/code already available on the system: Python (pydoc), Go (go doc), C/C++ (man pages + /usr/include headers).
 * No internet required.
 */
export class SystemSource extends DocSource {
    readonly label = "system";

    constructor(private root: string) {
        super();
    }

    supports(lang: Lang) {
        return lang === "py" || lang === "go" || lang === "c";
    }

    async find(req: DocRequest): Promise<DocPage | null> {
        if (req.lang === "py") return this.pydoc(req);
        if (req.lang === "go") return this.godoc(req);
        return this.cdocs(req);
    }

    private async pydoc({ name, topic }: DocRequest): Promise<DocPage | null> {
        // if topic is "dumps", try "json.dumps" first
        const candidates = topic && /^[A-Za-z_][\w.]*$/.test(topic) ? [`${name}.${topic}`, name] : [name];
        for (const c of candidates) {
            const r = await runCmd(["python3", "-m", "pydoc", c]);
            if (!r) return null; // python3 unavailable
            const out = r.out.trim();
            if (r.code === 0 && out && !out.startsWith("No Python documentation found")) {
                return { source: "pydoc (local Python)", location: `python3 -m pydoc ${c}`, text: extractRelevant(out, topic) };
            }
        }
        return null;
    }

    private async godoc({ name, topic }: DocRequest): Promise<DocPage | null> {
        const args = topic && /^[A-Za-z_][\w.]*$/.test(topic) ? [name, topic] : [name];
        const r = await runCmd(["go", "doc", ...args], { cwd: this.root });
        if (!r || r.code !== 0 || !r.out.trim()) return null;
        return { source: "go doc (local Go)", location: `go doc ${args.join(" ")}`, text: extractRelevant(r.out, topic) };
    }

    private async cdocs({ name, topic }: DocRequest): Promise<DocPage | null> {
        for (const section of ["3", "2"]) {
            const r = await runCmd(["man", "-P", "cat", section, name], { env: { MANWIDTH: "100" } });
            const out = r?.out.replace(/.\x08/g, "").trim() ?? "";
            // a real man page contains a "NAME" heading (minimal systems may print a notice and exit 0)
            if (r && r.code === 0 && /^NAME\s*$/m.test(out) && !/No manual entry/i.test(out)) {
                return { source: `man page (section ${section})`, location: `man ${section} ${name}`, text: extractRelevant(out, topic) };
            }
        }

        const header = await findHeader(name);
        if (!header) return null;
        const src = await readText(header);
        const text = (topic && grepContext(src, topic)) || src.slice(0, MAX_DOC_CHARS);
        return {
            source: "system header",
            location: header,
            text,
            hint: `Full file: bash \`sed -n '1,200p' ${header}\` or \`grep -n <symbol> ${header}\` (read_file works only inside the workspace)`,
        };
    }
}