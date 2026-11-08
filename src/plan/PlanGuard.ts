import type { Guard } from "../agent/Agent";
import type { Tool } from "../tools/Tool";
import type { PlanMode } from "./PlanMode";

/** Plan mode me sirf ye tools chalte hain; baaki sab blocked. */
const READ_ONLY = new Set([
    "read_file",
    "list_dir",
    "glob",
    "grep",
    "read_docs",
    "web_search",
    "web_fetch",
    "system_info",
    "skill",
    "ask_user",
    "todo",
    "exit_plan",
]);

/** bash me sirf job tracking allowed hai — naya command nahi. */
const BASH_SAFE = new Set(["status", "wait", "jobs"]);

/** git me sirf read-only actions. */
const GIT_SAFE = new Set(["status", "diff", "log", "show", "branch"]);

function blocked(label: string): string {
    return (
        `Plan mode is ON — ${label} is blocked (read-only). ` +
        "Investigate with read-only tools (read_file, list_dir, glob, grep, read_docs, web_search, web_fetch, git status/diff/log, system_info). " +
        'Then call exit_plan with the plan: exit_plan {"plan":"1. ...\\n  1.1 ..."}. ' +
        "The user must approve it before anything changes."
    );
}

/**
 * Plan mode ka guard: jab mode ON ho to koi bhi likhne/chalane wala tool block hota hai.
 * Blocked message model ko read-only plan banane aur exit_plan call karne ki taraf bhejta hai.
 */
export class PlanGuard implements Guard {
    constructor(private mode: PlanMode) {}

    async check(tool: Tool, args: Record<string, any>): Promise<string | undefined> {
        if (!this.mode.on) return undefined;
        if (READ_ONLY.has(tool.name)) return undefined;

        if (tool.name === "bash") {
            const action = String(args.action ?? "run").trim().toLowerCase();
            if (BASH_SAFE.has(action)) return undefined;
            return blocked(`bash action=${action}`);
        }

        if (tool.name === "git") {
            const action = String(args.action ?? "status").trim().toLowerCase();
            if (GIT_SAFE.has(action)) return undefined;
            return blocked(`git action=${action}`);
        }

        return blocked(tool.name);
    }
}
