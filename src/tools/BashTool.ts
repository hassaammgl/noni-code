import { type Job, JobManager } from "../jobs/JobManager";
import { Tool } from "./Tool";

const DEFAULT_GRACE_S = 30;
const DEFAULT_WAIT_S = 120;
const MAX_TIMEOUT_S = 600;
const ACTIONS = ["run", "start", "wait", "status", "jobs", "kill"] as const;

/** Explicit timeout clamp; invalid/zero pe fallback. */
export function timeoutFor(requested?: unknown, fallback = DEFAULT_GRACE_S): number {
    const n = Number(requested);
    if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), MAX_TIMEOUT_S);
    return fallback;
}

function actionOf(args: Record<string, any>): string {
    return String(args.action ?? "run").trim().toLowerCase() || "run";
}

function requireCommand(args: Record<string, any>): string {
    const command = String(args.command ?? "").trim();
    if (!command) throw new Error("command is empty");
    return command;
}

function requireJobId(args: Record<string, any>): string {
    const id = String(args.job_id ?? "").trim();
    if (!id) throw new Error("job_id is required for this action (use action=jobs to see job ids)");
    return id;
}

/** Risky command patterns. Matches show the issue to the user and require double confirmation. */
const RISKS: { re: RegExp; msg: string }[] = [
    {
        re: /(^|[\s;&|(`$/\\])sudo(\s|$)/,
        msg: "sudo: this command runs with root (admin) privileges. A mistake can damage the system.",
    },
    {
        re: /(^|[\s;&|(`/\\])rm(\s|$)/,
        msg: "rm: files are permanently deleted. They do not go to Trash and cannot be recovered.",
    },
    {
        re: /(^|[\s;&|(`/\\])rm\s+(-\S*\s+)*-\S*[rRf]/,
        msg: "rm -r/-f: can delete an entire folder without prompting (-f suppresses warnings).",
    },
    { re: /\bfind\b[^\n]*(-delete|-exec\s+rm)/, msg: "find -delete/-exec rm: can delete many files at once." },
    { re: /(^|[\s;&|(`/\\])(shred|unlink|rmdir)(\s|$)/, msg: "shred/unlink/rmdir: deletes files or folders." },
    { re: /(^|[\s;&|(`/\\])(dd|mkfs(\.\w+)?|fdisk|parted)(\s|$)/, msg: "dd/mkfs/fdisk: can overwrite or format disk/partition data." },
    { re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, msg: "curl|sh: downloads and executes a script from the internet without inspection." },
    { re: /\b(chmod|chown)\s+(-\S*\s+)*-\S*R/, msg: "chmod/chown -R: changes permissions across an entire folder tree." },
    {
        re: /\bgit\s+(reset\s+--hard|clean\s+-\S*f|push\s+[^\n]*(--force|-f\b))/,
        msg: "git reset --hard / clean -f / push --force: can permanently discard uncommitted or remote work.",
    },
    { re: /(^|[\s;&|(`/\\])(shutdown|reboot|poweroff|halt)(\s|$)/, msg: "shutdown/reboot: will shut down or restart the machine." },
];

/**
 * Shell commands run through background jobs.
 * `run` waits in the foreground; on timeout the process is not killed, it becomes a job.
 * The agent can track jobs with `wait`/`status` and stop them with `kill`.
 */
export class BashTool extends Tool {
    name = "bash";
    description =
        "Run a shell command in the workspace. Use for git, scripts, builds, tests, installs. " +
        "For reading files use read_file, for folders use list_dir, and for finding files use glob/grep — NOT bash. " +
        "Commands must not be interactive. " +
        `action=run (default) waits up to timeout_seconds (${DEFAULT_GRACE_S}s), then moves the process to the background instead of killing it. ` +
        "Use action=wait/status/jobs to track background jobs, action=start to background immediately, action=kill to stop one. " +
        `action=jobs lists background jobs only, never files. Long waits can go up to ${MAX_TIMEOUT_S}s. Never use sudo or rm unless the user asked for it.`;
    parameters = {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [...ACTIONS],
                description:
                    "run (default): wait, then background. start: background now. wait: wait for a job. " +
                    "status: one job + output. jobs: all background jobs (NOT files — use the list_dir tool for folders). kill: stop a job.",
            },
            command: { type: "string", description: "Shell command for action=run/start" },
            job_id: { type: "string", description: "Job id from a previous run/start (for wait/status/kill)" },
            timeout_seconds: {
                type: "number",
                description:
                    `run: foreground wait before backgrounding (default ${DEFAULT_GRACE_S}); ` +
                    `wait: max wait (default ${DEFAULT_WAIT_S}); max ${MAX_TIMEOUT_S}`,
            },
        },
    };
    override dangerous = true;

    constructor(
        private root: string,
        private jobs: JobManager,
    ) {
        super();
    }

    override dangerousFor(args: Record<string, any>): boolean {
        const action = actionOf(args);
        return action === "run" || action === "start" || action === "kill";
    }

    override warnings(args: Record<string, any>): string[] {
        const action = actionOf(args);
        if (action !== "run" && action !== "start") return [];
        const cmd = String(args.command ?? "");
        return RISKS.filter((r) => r.re.test(cmd)).map((r) => r.msg);
    }

    override async preview(args: Record<string, any>) {
        const action = actionOf(args);
        if (action === "run" || action === "start") {
            const command = requireCommand(args);
            const when = action === "start" ? "starts in background" : `background after ${timeoutFor(args.timeout_seconds)}s`;
            return `$ ${command}\n(${when}, cwd: workspace)`;
        }
        if (action === "kill") return `kill job ${String(args.job_id ?? "?")}`;
        return action;
    }

    async run(args: Record<string, any>) {
        const action = actionOf(args);

        switch (action) {
            case "run": {
                const command = requireCommand(args);
                const secs = timeoutFor(args.timeout_seconds);
                const job = this.jobs.start(command, this.root);
                const { job: finished, timedOut } = await this.jobs.wait(job.id, secs * 1000);

                if (!timedOut) return this.result(finished);
                return [
                    `Job ${job.id} is still running after ${secs}s. It was moved to the background, NOT killed.`,
                    this.jobs.describe(job),
                    `Wait: bash {"action":"wait","job_id":"${job.id}","timeout_seconds":${DEFAULT_WAIT_S}}`,
                    `Status: bash {"action":"status","job_id":"${job.id}"}`,
                    `Output so far:\n${this.jobs.output(job, 8_000)}`,
                ].join("\n");
            }

            case "start": {
                const command = requireCommand(args);
                const job = this.jobs.start(command, this.root);
                return [
                    `Job ${job.id} started in the background.`,
                    this.jobs.describe(job),
                    `Wait: bash {"action":"wait","job_id":"${job.id}","timeout_seconds":${DEFAULT_WAIT_S}}`,
                    `Status: bash {"action":"status","job_id":"${job.id}"}`,
                ].join("\n");
            }

            case "wait": {
                const id = requireJobId(args);
                const secs = timeoutFor(args.timeout_seconds, DEFAULT_WAIT_S);
                const { job, timedOut } = await this.jobs.wait(id, secs * 1000);
                if (!timedOut) return this.result(job);
                return [
                    `Job ${job.id} is still running after waiting ${secs}s.`,
                    this.jobs.describe(job),
                    `You can wait again, or do other subtasks first and come back.`,
                    `Output tail:\n${this.jobs.output(job, 6_000)}`,
                ].join("\n");
            }

            case "status": {
                const id = String(args.job_id ?? "").trim();
                if (!id) return `No job_id given. Background jobs:\n${this.jobs.render()}`;
                const job = this.jobs.get(id);
                return `${this.jobs.describe(job)}\n${this.jobs.output(job, 8_000)}`;
            }

            case "jobs":
                return this.jobs.render();

            case "kill": {
                const id = requireJobId(args);
                const before = this.jobs.get(id);
                const wasRunning = before.status === "running";
                const job = this.jobs.kill(id);
                return wasRunning
                    ? `Killed job ${job.id}.\n${this.jobs.describe(job)}`
                    : `Job ${job.id} is already ${job.status}.\n${this.jobs.describe(job)}`;
            }

            default:
                if (action === "list" || action === "list_dir" || action === "ls") {
                    throw new Error(
                        `unknown action: ${action}. For folders use the list_dir tool; for files use read_file/glob/grep. ` +
                            "For background jobs use action=jobs.",
                    );
                }
                throw new Error(`unknown action: ${action}. Use one of: ${ACTIONS.join(", ")}`);
        }
    }

    private result(job: Job): string {
        const out = this.jobs.output(job);
        if (job.status === "done") return out;
        return `Job ${job.id} ${job.status}${job.exitCode === undefined ? "" : ` (exit ${job.exitCode})`}.\n${out}`;
    }
}
