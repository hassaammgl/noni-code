import { spawn } from "node:child_process";
import { Tool } from "./Tool";

const ACTIONS = ["status", "diff", "log", "show", "branch", "add", "commit"] as const;
const MAX_OUTPUT = 10_000;

/** Trim long git output to head + tail to avoid filling context */
function clip(text: string): string {
    if (text.length <= MAX_OUTPUT) return text;
    const cut = text.length - MAX_OUTPUT;
    return `${text.slice(0, 6_000)}\n… [${cut} chars cut] …\n${text.slice(-4_000)}`;
}

/**
 * Dedicated safe Git tool — avoids building shell strings for routine operations.
 * Only read-only actions plus add/commit; push/reset-like actions are intentionally excluded.
 */
export class GitTool extends Tool {
    name = "git";
    description =
        "Run a git command in the workspace. Read-only: action=status/diff/log/show/branch. " +
        "Write: action=add (stage files) and action=commit (needs message). Push/reset are not supported — use bash only if the user asks.";
    parameters = {
        type: "object",
        properties: {
            action: { type: "string", enum: [...ACTIONS], description: "status/diff/log/show/branch/add/commit" },
            path: { type: "string", description: "Limit diff/status/show to this path" },
            ref: { type: "string", description: "Commit/ref for action=show or log (default HEAD / current branch)" },
            staged: { type: "boolean", description: "action=diff: show staged (--cached) changes" },
            limit: { type: "number", description: "action=log: how many commits (default 20, max 200)" },
            files: { type: "array", items: { type: "string" }, description: "action=add: paths to stage (default: all changes)" },
            message: { type: "string", description: "action=commit: commit message" },
        },
        required: ["action"],
    };

    constructor(private root: string) {
        super();
    }

    /** Only commit is treated as destructive; add can be unstaged. */
    override dangerousFor(args: Record<string, any>): boolean {
        return actionOf(args) === "commit";
    }

    override preview(args: Record<string, any>) {
        const action = actionOf(args);
        if (action === "commit") return `git commit -m ${JSON.stringify(String(args.message ?? ""))}`;
        if (action === "add") return `git add ${(args.files ?? []).join(" ") || "-A"}`;
        return `git ${action}`;
    }

    async run(args: Record<string, any>) {
        const action = actionOf(args);
        const path = String(args.path ?? "").trim();
        const ref = String(args.ref ?? "").trim();

        switch (action) {
            case "status": {
                const out = await this.git(["status", "--short", "--branch", ...(path ? ["--", path] : [])]);
                return out || "(clean)";
            }
            case "diff": {
                const out = await this.git(["diff", ...(args.staged ? ["--cached"] : []), ...(ref ? [ref] : []), ...(path ? ["--", path] : [])]);
                return out || "(no changes)";
            }
            case "log": {
                const n = Math.min(Math.max(Math.floor(Number(args.limit) || 20), 1), 200);
                const out = await this.git(["log", "--oneline", "--decorate", `-n${n}`, ref || "HEAD", ...(path ? ["--", path] : [])]);
                return out || "(no commits)";
            }
            case "show": {
                const out = await this.git(["show", "--stat", "--patch", ref || "HEAD", ...(path ? ["--", path] : [])]);
                return out;
            }
            case "branch":
                return (await this.git(["branch", "-a", "--no-color"])) || "(no branches)";
            case "add": {
                const files = Array.isArray(args.files) ? args.files.map((f: any) => String(f)).filter(Boolean) : [];
                return (await this.git(["add", ...(files.length ? files : ["-A"])])) || `staged ${files.length ? files.join(", ") : "all changes"}`;
            }
            case "commit": {
                const message = String(args.message ?? "").trim();
                if (!message) throw new Error("message is required for action=commit");
                return (await this.git(["commit", "-m", message])) || "committed";
            }
            default:
                throw new Error(`unknown action: ${action}. Use one of: ${ACTIONS.join(", ")}`);
        }
    }

    /** Run with an args array (not a shell string) and return clipped output. */
    private git(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn("git", args, {
                cwd: this.root,
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
            });

            let out = "";
            let err = "";
            child.stdout?.on("data", (chunk) => {
                out += String(chunk);
            });
            child.stderr?.on("data", (chunk) => {
                err += String(chunk);
            });
            child.on("error", () => reject(new Error(`failed to start git ${args[0]} (is git installed?)`)));
            child.on("close", (code) => {
                const text = clip([out, err].filter(Boolean).join("\n").trim());
                if (code !== 0) reject(new Error(text || `git ${args[0]} failed (exit ${code})`));
                else resolve(text);
            });
        });
    }
}

function actionOf(args: Record<string, any>): string {
    return String(args.action ?? "status").trim().toLowerCase() || "status";
}
