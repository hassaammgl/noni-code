import { Ollama } from "ollama";
import { Agent, type AgentUI } from "../agent/Agent";
import type { NoniConfig } from "../config/Config";
import { loadConfig } from "../config/Config";
import { DocsGuard, DocsRegistry } from "../docs/DocsGuard";
import { HistoryStore, type HistoryMessage } from "../history/HistoryStore";
import { PlanGuard } from "../plan/PlanGuard";
import { PlanMode } from "../plan/PlanMode";
import { SkillStore } from "../skills/SkillStore";
import { NodeModulesSource, SystemSource } from "../docs/LocalSources";
import { RegistrySource, WebDocsSource } from "../docs/RemoteSources";
import { JobManager } from "../jobs/JobManager";
import { McpManager } from "../mcp/McpManager";
import { DuckDuckGoProvider } from "../search/DuckDuckGoProvider";
import { SearchEngine } from "../search/SearchEngine";
import { SearxngProvider } from "../search/SearxngProvider";
import { TodoStore } from "../todos/TodoStore";
import { AskUserTool } from "../tools/AskUserTool";
import { BashTool } from "../tools/BashTool";
import { ReadDocsTool } from "../tools/DocsTool";
import {
    DeleteFileTool,
    EditFileTool,
    ListDirTool,
    MakeDirTool,
    MoveFileTool,
    ReadFileTool,
    ReplaceLinesTool,
    WriteFileTool,
} from "../tools/FileTool";
import { GitTool } from "../tools/GitTool";
import { GlobTool, GrepTool } from "../tools/SearchTools";
import { SystemInfoTool } from "../tools/SystemTool";
import { SkillTool } from "../tools/SkillTool";
import { ExitPlanTool } from "../tools/PlanTool";
import { TodoTool } from "../tools/TodoTool";
import { WebFetchTool, WebSearchTool } from "../tools/WebTools";

/** UI required by the runtime: Agent callbacks plus a question prompt for ask_user. */
export type RuntimeUI = AgentUI & {
    ask(question: string, options?: string[]): Promise<string>;
};

export interface RuntimeOptions {
    cwd: string;
    model: string;
    ui: RuntimeUI;
}

export interface Runtime {
    cwd: string;
    ollama: Ollama;
    jobs: JobManager;
    agent: Agent;
    todos: TodoStore;
    docs: DocsRegistry;
    /** `.ai` skill packs (index prompt me, body on demand). */
    skills: SkillStore;
    /** Plan mode: read-only investigation, exit_plan se approval. */
    planMode: PlanMode;
    search: SearchEngine;
    mcp: McpManager;
    config: NoniConfig;
    configError?: string;
    /** Runtime banate waqt di gayi UI (TUI ya web). */
    ui: RuntimeUI;
    /** SQLite chat history (sessions + messages). */
    history: HistoryStore;
    /** Current history session being written to. */
    sessionId: number;
    newSession(): number;
    loadSession(id: number): HistoryMessage[];
    /** Ek waqt me ek hi agent run (TUI ya web client). */
    runLock: RunLock;
    shutdown(): Promise<void>;
}

/** Simple mutex: prevents the TUI and web client from running the agent concurrently. */
export class RunLock {
    private locked = false;

    get busy() {
        return this.locked;
    }

    tryAcquire(): boolean {
        if (this.locked) return false;
        this.locked = true;
        return true;
    }

    release() {
        this.locked = false;
    }
}

/** Plan-first default: ON, jab tak `NONI_PLAN_MODE=off` na ho. */
function planModeDefault(): boolean {
    const raw = String(process.env.NONI_PLAN_MODE ?? "").trim().toLowerCase();
    return !["off", "0", "false", "no"].includes(raw);
}

/**
 * Build a shared agent/tool stack for both the TUI and web server.
 * UI is injected, so the same tools work in the terminal and browser.
 */
export async function createRuntime({ cwd, model, ui }: RuntimeOptions): Promise<Runtime> {
    const jobs = new JobManager();
    const ollama = new Ollama({
        host: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    });
    const mcp = new McpManager();

    const { config, error: configError } = await loadConfig();
    const agent = new Agent(ollama, model, ui, cwd, config.llm);
    const runLock = new RunLock();
    const history = new HistoryStore();
    let sessionId = history.createSession({ model, cwd });
    agent.onMessage((msg) => history.append(sessionId, msg));

    const search = new SearchEngine([
        new SearxngProvider(process.env.SEARXNG_URL ?? "http://localhost:8080"), // prefer local instance
        new DuckDuckGoProvider(), // fallback
    ]);
    const docs = new DocsRegistry();
    const todos = new TodoStore();

    // `.ai` skills: only the index goes into the system prompt; full text loads via the `skill` tool
    const skills = new SkillStore(cwd);
    await skills.load();
    agent.useSkills(skills);

    // Plan mode: when ON, only read-only tools are allowed; approval comes via exit_plan.
    // Runs before DocsGuard so the plan-mode message is shown.
    const planMode = new PlanMode(planModeDefault());
    agent.setPlanMode(() => planMode.on);
    agent.addGuard(new PlanGuard(planMode));
    // require docs to be read before edits that add third-party imports
    agent.addGuard(new DocsGuard(docs, cwd));
    // Include the plan in every run system prompt so the model does not lose track of tasks
    agent.addContext(() => (todos.size ? todos.render(6_000) : ""));

    const mcpTools = await mcp.load(config.mcp.servers);
    agent.addTools(
        new ReadFileTool(cwd),
        new ListDirTool(cwd),
        new WriteFileTool(cwd),
        new EditFileTool(cwd),
        new ReplaceLinesTool(cwd),
        new MoveFileTool(cwd),
        new MakeDirTool(cwd),
        new GitTool(cwd),
        new AskUserTool((question, options) => ui.ask(question, options)),
        new DeleteFileTool(cwd),
        new BashTool(cwd, jobs),
        new GlobTool(cwd),
        new GrepTool(cwd),
        new SystemInfoTool(),
        new TodoTool(todos),
        new SkillTool(skills),
        new ExitPlanTool(planMode, todos, async (plan) => {
            const approved = await agent.approvePlan(plan);
            if (approved) {
                // After approval, let the agent execute todos step by step without pausing
                agent.startPlanExecution(() => {
                    const stats = todos.stats();
                    return stats.done < stats.total;
                });
            }
            return approved;
        }),
        new WebSearchTool(search),
        new WebFetchTool(),
        new ReadDocsTool(docs, [
            new NodeModulesSource(cwd), // JS/TS: installed package
            new SystemSource(cwd), // Python (pydoc), Go (go doc), C/C++ (man + /usr/include)
            new RegistrySource(), // npm / PyPI
            new WebDocsSource(search), // last resort
        ]),
        ...mcpTools,
    );

    const runtime: Runtime = {
        cwd,
        ollama,
        jobs,
        agent,
        todos,
        docs,
        skills,
        planMode,
        search,
        mcp,
        config,
        configError,
        ui,
        history,
        sessionId,
        newSession() {
            sessionId = history.createSession({ model: agent.model, cwd });
            agent.reset();
            runtime.sessionId = sessionId;
            return sessionId;
        },
        loadSession(id) {
            if (!history.get(id)) throw new Error(`history session #${id} not found`);
            const messages = history.messages(id);
            sessionId = id;
            agent.loadHistory(messages);
            runtime.sessionId = id;
            return messages;
        },
        runLock,
        async shutdown() {
            history.close();
            await jobs.closeAll();
            await mcp.close();
        },
    };

    return runtime;
}
