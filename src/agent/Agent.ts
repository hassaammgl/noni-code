import type { Message, Ollama, ToolCall } from "ollama";
import type { Tool } from "../tools/Tool";
import type { LlmSettings } from "../config/Config";
import type { SkillStore } from "../skills/SkillStore";
import { readText } from "../util/Fs";

export interface AgentUI {
    assistantStart(): void;
    assistantDelta(text: string): void;
    assistantEnd(): void;
    thinkingDelta?(text: string): void;
    thinkingEnd?(): void;
    waiting?(label?: string): void;
    waitingEnd?(): void;
    toolCall(name: string, args: Record<string, any>): void;
    toolResult(result: string, isError: boolean): void;
    warn?(msg: string): void;
    confirm(name: string, args: Record<string, any>, preview?: string, warnings?: string[]): Promise<boolean>;
    confirmStrict(): Promise<boolean>;
    /** Approval for exiting plan mode; falls back to confirm() if unavailable. */
    approvePlan?(plan: string): Promise<boolean>;
}

/** Read a positive integer from env, otherwise use fallback. 0/NaN/"abc" are ignored. */
function envInt(name: string, fallback: number): number {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Detect Ollama/Bun timeout errors so retries only shrink context for those cases. */
function isTimeoutError(e: unknown): boolean {
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    return /timeout|timed out|abort|aborted/i.test(msg);
}

/** Transient network/server errors: safe to retry the same request. */
function isTransientError(e: unknown): boolean {
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    return /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|overloaded|\b(429|500|502|503|504)\b/i.test(
        msg,
    );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Optional fallback if the model has no metadata. */
const FALLBACK_NUM_CTX = 32_768;
/** Shrinking context below this is not useful. */
const MIN_NUM_CTX = 4_096;
/** Approved plan khud chalte waqt model kitni baar ruk kar nudge accept kare. */
const MAX_AUTO_CONTINUE = 10;
/** Number of retries for network/5xx errors. */
const MAX_TRANSIENT_RETRIES = 3;
/** These file mutations do not require reconfirmation inside an approved plan. */
const PLAN_WRITES = new Set([
    "write_file",
    "edit_file",
    "replace_lines",
    "delete_file",
    "move_file",
    "make_dir",
]);
const NUM_PREDICT = envInt("OLLAMA_NUM_PREDICT", 4_096);
const TEMPERATURE = (() => {
    const n = Number(process.env.OLLAMA_TEMPERATURE);
    return Number.isFinite(n) && n >= 0 ? n : 0.4;
})();

/** Pre-tool check. Returning a string blocks the tool and sends that string to the model as an error. */
export interface Guard {
    check(tool: Tool, args: Record<string, any>): Promise<string | undefined>;
    reset?(): void;
}

/** Messages added to the conversation by the agent (for history storage). */
export interface AgentMessageEvent {
    role: "user" | "assistant";
    content: string;
    thinking?: string;
}

/** Persona lives in persona.md so it can be edited without touching the app. */
const PERSONA = (await readText(new URL("./persona.md", import.meta.url))).trim();

export class Agent {
    private tools = new Map<string, Tool>();
    private guards: Guard[] = [];
    private contexts: (() => string)[] = [];
    private messages: Message[] = [];
    private ctxByModel = new Map<string, number>();
    private messageSink?: (msg: AgentMessageEvent) => void;
    private skills?: SkillStore;
    private planModeGetter?: () => boolean;
    /** After plan approval: if todos remain, let the model continue on its own. */
    private continueCheck?: () => boolean;
    private autoContinues = 0;
    public think = false;

    constructor(
        private ollama: Ollama,
        public model: string,
        private ui: AgentUI,
        private cwd: string,
        private llm: LlmSettings = {},
    ) {
        this.reset();
    }

    addTools(...tools: Tool[]) {
        for (const t of tools) this.tools.set(t.name, t);
    }

    addGuard(guard: Guard) {
        this.guards.push(guard);
    }

    /** Swap UI for a run (TUI ↔ web client); runs remain serialized. */
    setUI(ui: AgentUI) {
        this.ui = ui;
    }

    /** Har user/assistant message ek sink ko do (SQLite history). */
    onMessage(sink: (msg: AgentMessageEvent) => void) {
        this.messageSink = sink;
    }

    /** Only the `.ai` skills index goes into the system prompt; full text loads via the `skill` tool. */
    useSkills(store: SkillStore) {
        this.skills = store;
    }

    /** Live plan-mode state (shared by the TUI and web). */
    setPlanMode(getter: () => boolean) {
        this.planModeGetter = getter;
    }

    /** Approval for exit_plan — requested through the active UI. */
    async approvePlan(plan: string): Promise<boolean> {
        if (this.ui.approvePlan) return this.ui.approvePlan(plan);
        return this.ui.confirm("exit_plan", { plan }, plan);
    }

    /**
     * Execute an approved plan autonomously: if the model stops and todos remain,
     * send a nudge and continue the loop.
     */
    startPlanExecution(check: () => boolean) {
        this.continueCheck = check;
        this.autoContinues = 0;
    }

    /** File edits are pre-approved inside an approved plan; commands like bash/git are not. */
    private planWriteApproved(tool: Tool): boolean {
        return !!this.continueCheck?.() && PLAN_WRITES.has(tool.name);
    }

    /** Reload prior chat into context (tool/todo runtime state stays fresh). */
    loadHistory(items: { role: string; content: string; thinking?: string }[]) {
        const past: Message[] = items
            .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
            .map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
                ...(m.thinking ? { thinking: m.thinking } : {}),
            }));
        this.messages = [{ role: "system", content: this.systemPrompt() }, ...past];
    }

    /** Har run ke system prompt me extra live context (jaise current todo plan). */
    addContext(provider: () => string) {
        this.contexts.push(provider);
    }

    listTools() {
        return [...this.tools.values()];
    }

    /**
     * Model context length. Prefer env, then config (`llm.num_ctx`), then the model maximum.
     * Default config is `"max"`, so each model uses its full context.
     */
    private async numCtx(): Promise<number> {
        const fromEnv = Number(process.env.OLLAMA_NUM_CTX);
        if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);

        const configured = this.llm.num_ctx;
        if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
            return Math.floor(configured);
        }

        const cached = this.ctxByModel.get(this.model);
        if (cached) return cached;

        try {
            const info = await this.ollama.show({ model: this.model });
            const raw = info.model_info as unknown;
            const entries =
                raw instanceof Map ? [...raw.entries()] : Object.entries((raw ?? {}) as Record<string, unknown>);
            const found = entries.find(([k]) => String(k).endsWith(".context_length"));
            const n = Number(found?.[1]);
            if (Number.isFinite(n) && n > 0) {
                this.ctxByModel.set(this.model, n);
                return n;
            }
        } catch {
            // metadata na mile to safe fallback
        }
        return FALLBACK_NUM_CTX;
    }

    reset() {
        this.messages = [{ role: "system", content: this.systemPrompt() }];
        this.guards.forEach((g) => g.reset?.()); // /clear pe docs-read list bhi saaf
    }

    /** Persona + live system info, so Noni knows where it is running */
    private systemPrompt() {
        const tools = this.listTools().map((t) => t.name).join(", ") || "none";
        const os = ({ linux: "Linux", darwin: "macOS", win32: "Windows" } as Record<string, string>)[process.platform] ?? process.platform;
        const arch = ({ x64: "x86_64", arm64: "arm64", ia32: "x86" } as Record<string, string>)[process.arch] ?? process.arch;
        const extra = this.contexts
            .map((fn) => {
                try {
                    return fn().trim();
                } catch {
                    return "";
                }
            })
            .filter(Boolean)
            .join("\n\n");
        const skills = this.skills?.renderIndex() ?? "";
        const planMode = this.planModeGetter?.() ?? false;
        return `${PERSONA}

## Environment (live, authoritative)
- Operating system: ${os} (${arch})
- Working directory: ${this.cwd}
- Shell: bash -lc; user shell: ${process.env.SHELL ?? "unknown"}
- Runtime: JavaScript on ${process.release?.name ?? "node"} ${process.version}
- Date: ${new Date().toISOString().slice(0, 10)}
- Model: ${this.model}
- Tools: ${tools}
- Paths: relative to the working directory (e.g. src/index.ts). Don't wander outside it.
- For battery, CPU, memory, disk and uptime, use the system_info tool. Never guess hardware numbers.
- If the user asks about the system, answer from this block. Do not guess or contradict it.
${planMode ? `\n## Plan mode (ACTIVE — read-only)\nYou may not edit files, create or delete anything, run commands, install, or commit. Investigate with read-only tools (read_file, list_dir, glob, grep, read_docs, web_search, web_fetch, git status/diff/log/show, system_info, todo, skill), then submit a short nested plan with exit_plan {"plan":"1. ...\\n  1.1 ..."}. The user must approve it before any change happens. If the user asks you to edit now, explain that plan mode is on and present the plan first.\n` : ""}${skills ? `\n## Skills (index only — load full text with the skill tool)\n${skills}\n` : ""}${extra ? `\n## Current plan (live)\n${extra}\n` : ""}
## Reminder (always true)
- NONI is female: every Hindi/Urdu verb about yourself is feminine — "kar rahi hoon", "bataungi", "dekhi thi", "chala rahi hoon".
- One short dry joke is fine. Two is a stand-up set, and this is a terminal.`;
    }

    /** Whether the model accepts vision (image) input — from Ollama capabilities, cached per model */
    private visionByModel = new Map<string, boolean>();
    async supportsVision(): Promise<boolean> {
        const cached = this.visionByModel.get(this.model);
        if (cached !== undefined) return cached;
        try {
            const info: any = await this.ollama.show({ model: this.model });
            const caps: string[] = Array.isArray(info?.capabilities) ? info.capabilities : [];
            const ok = caps.includes("vision");
            this.visionByModel.set(this.model, ok);
            return ok;
        } catch {
            return false;
        }
    }

    async run(input: string, images: string[] = []) {
        // New user turn = stop previous plan auto-run
        this.continueCheck = undefined;
        this.autoContinues = 0;
        // Refresh the system prompt on every run so model/tools/date stay current
        this.messages[0] = { role: "system", content: this.systemPrompt() };
        this.messages.push({ role: "user", content: input, ...(images.length ? { images } : {}) });
        this.messageSink?.({ role: "user", content: input });

        await this.loop();
    }

    /** LLM -> tools -> LLM ... jab tak tool call aati rahe */
    private async loop() {
        // If the model times out, use half context for remaining calls in this run
        let ctxOverride: number | undefined;
        // Lagataar network/5xx failures; successful stream pe reset
        let transientRetries = 0;

        while (true) {
            this.ui.waiting?.();
            let numCtx = ctxOverride ?? (await this.numCtx());
            const open = () =>
                this.ollama.chat({
                    model: this.model,
                    messages: this.messages,
                    tools: this.listTools().map((t) => t.toOllama()),
                    think: this.think,
                    stream: true,
                    keep_alive: "30m",
                    options: {
                        num_ctx: numCtx,
                        num_predict: NUM_PREDICT,
                        temperature: TEMPERATURE,
                    },
                });

            let stream;
            while (true) {
                try {
                    stream = await open();
                    break;
                } catch (e) {
                    if (isTimeoutError(e) && numCtx > MIN_NUM_CTX) {
                        numCtx = Math.max(MIN_NUM_CTX, Math.floor(numCtx / 2));
                        ctxOverride = numCtx;
                        this.ui.warn?.(`model request timed out; retrying with num_ctx=${numCtx}...`);
                        continue;
                    }
                    if (transientRetries < MAX_TRANSIENT_RETRIES && isTransientError(e)) {
                        transientRetries++;
                        this.ui.warn?.(
                            `model request failed (${e instanceof Error ? e.message : String(e)}); ` +
                                `retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}...`,
                        );
                        await sleep(400 * transientRetries);
                        continue;
                    }
                    throw e;
                }
            }

            let content = "";
            let thinking = "";
            let doneReason = "";
            const calls: ToolCall[] = [];
            let started = false;

            try {
                for await (const part of stream) {
                    this.ui.waitingEnd?.();
                    if (part.done) doneReason = part.done_reason;
                    const msg = part.message;
                    if (msg.thinking) {
                        thinking += msg.thinking;
                        this.ui.thinkingDelta?.(msg.thinking);
                    }
                    if (msg.content) {
                        if (!started) {
                            started = true;
                            this.ui.assistantStart();
                        }
                        content += msg.content;
                        this.ui.assistantDelta(msg.content);
                    }
                    if (msg.tool_calls?.length) calls.push(...msg.tool_calls);
                }
            } catch (e) {
                // Retry only when nothing has been rendered yet
                const clean = !started && !thinking && !calls.length;
                if (clean && isTimeoutError(e) && numCtx > MIN_NUM_CTX) {
                    numCtx = Math.max(MIN_NUM_CTX, Math.floor(numCtx / 2));
                    ctxOverride = numCtx;
                    this.ui.warn?.(`model stream timed out; retrying with num_ctx=${numCtx}...`);
                    continue;
                }
                if (clean && !isTimeoutError(e) && isTransientError(e) && transientRetries < MAX_TRANSIENT_RETRIES) {
                    transientRetries++;
                    this.ui.warn?.(
                        `model stream failed (${e instanceof Error ? e.message : String(e)}); ` +
                            `retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}...`,
                    );
                    await sleep(400 * transientRetries);
                    continue;
                }
                throw e;
            }

            transientRetries = 0;

            this.ui.waitingEnd?.();
            if (thinking) this.ui.thinkingEnd?.();
            if (started) this.ui.assistantEnd();
            if (doneReason === "length") {
                this.ui.warn?.(
                    `reply cut short: model limit hit (num_ctx=${numCtx}, num_predict=${NUM_PREDICT}). ` +
                        `Use /clear if the chat is long; increase OLLAMA_NUM_PREDICT for longer replies.`,
                );
            }

            const reply: Message = { role: "assistant", content };
            if (thinking) reply.thinking = thinking;
            if (calls.length) reply.tool_calls = calls;
            this.messages.push(reply);
            if (content || thinking) {
                this.messageSink?.({
                    role: "assistant",
                    content,
                    thinking: thinking || undefined,
                });
            }

            if (!calls.length) {
                // Approved plan still has todos? Continue the model silently.
                if (this.continueCheck?.()) {
                    if (this.autoContinues < MAX_AUTO_CONTINUE) {
                        this.autoContinues++;
                        this.messages.push({
                            role: "user",
                            content:
                                "Continue the approved plan on your own. " +
                                'Call todo {"action":"next"}, do that step, mark it done with ' +
                                'todo {"action":"done","id":"..."}, then move to the next one. ' +
                                "Do not stop to ask for permission between steps; only stop when every todo is done or you are blocked.",
                        });
                        continue;
                    }
                    this.ui.warn?.(
                        `plan auto-run paused: model stopped ${MAX_AUTO_CONTINUE} times with todos left. ` +
                            'Send "continue" to resume.',
                    );
                }
                return;
            }

            for (const call of calls) {
                const { name, arguments: args } = call.function;
                this.messages.push({ role: "tool", tool_name: name, content: await this.execute(name, args) });
            }
        }
    }

    private async execute(name: string, args: Record<string, any>): Promise<string> {
        const started = Date.now();
        const tool = this.tools.get(name);
        if (!tool) return this.fail(`unknown tool ${name}`, name, started);

        this.ui.toolCall(name, args);

        try {
            // Run guards before dangerous confirmation: blocked edits should not prompt the user
            for (const guard of this.guards) {
                const blocked = await guard.check(tool, args);
                if (blocked) return this.fail(blocked, name, started);
            }

            if (tool.dangerousFor(args) && !this.planWriteApproved(tool)) {
                const warnings = tool.warnings(args);
                const preview = await tool.preview?.(args);
                if (!(await this.ui.confirm(name, args, preview, warnings))) {
                    return this.fail("user denied this action", name, started);
                }
                if (warnings.length && !(await this.ui.confirmStrict())) {
                    return this.fail(
                        "user denied this risky command. Do not retry it; ask the user what to do instead.",
                        name,
                        started,
                    );
                }
            }

            this.ui.waiting?.(`running ${name}`);
            let out: string;
            try {
                out = await tool.run(args);
            } finally {
                this.ui.waitingEnd?.();
            }
            this.ui.toolResult(out, false);
            return out;
        } catch (e: any) {
            return this.fail(e.message, name, started);
        }
    }

    private fail(msg: string, toolName?: string, startedAt?: number): string {
        this.ui.toolResult(msg, true);
        return `Error: ${msg}`;
    }
}