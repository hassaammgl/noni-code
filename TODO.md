# TODO

Roadmap for Noni. Ordered by impact, not by effort.

## Next

- [ ] **Checkpoints / undo** — snapshot files before each edit; `/undo` rolls back code + conversation. Without this, there is no direct way to revert agent-made file changes.
- [ ] **Subagents** — a tool that works in a separate context and returns a summary. Enables parallel tasks, less context pollution, and cheaper long investigations.
- [ ] **Project memory** — auto-load `<project>/NONI.md` (hierarchy: project → `~/.config/noni-chan/NONI.md`) so the same instructions don't need to be repeated every session.
- [ ] **Permission rules** — allow/ask/deny rules per tool/command in `.noni/settings.json`; currently only per-call confirm + plan guard exist.
- [ ] **Auto-compaction** — summarize older turns before context fills; reduce the need for manual `/clear`.
- [ ] **Headless mode** — `noni -p "prompt"` + JSON/stream output for CI and scripts (`serve.ts` is currently HTTP-only).

## Multi-agent: Noni ka Ghar

Goal: turn Noni into a small household of agents. One Master agent talks to the user and hands small, self-contained jobs to specialist child agents through a `delegate` tool. The models are small (qwen 4B/9B on CPU), so the design stays simple: sequential first, read-only first, then widen slowly. This is not a rewrite; it adds small layers on top of the existing `Agent` and `Runtime`.

### Design rules (apply to every phase)

- [ ] **Language rule:** everything written into the project must be in English only. This covers code, comments, identifiers, variable and function names, commit messages, log and error messages, UI strings, agent prompts (`agents/*.md`), README/TOOLS/TODO text, tests and config files. No Hinglish, Hindi or Urdu anywhere in the repo. Chatting with the user in Hinglish is fine; anything saved to a file is English.
- [ ] **Single model rule:** only the model the user selected (ModelPicker or `/model`) is used. No per-agent model, no separate router and no code model. Master and every child run on that one model. The only differences between agents are prompt, tool allowlist, `maxSteps`, thinking on/off and temperature.
- [ ] v1 is sequential: one child at a time, read-only tools only, depth 1 (a child cannot delegate further).
- [ ] A child never receives the parent's `messageSink`, UI, `RunLock`, `PlanMode`, `TodoStore`, `JobManager`, `ask_user` or `exit_plan`.
- [ ] Every child gets `maxSteps` and a timeout. If the same output or the same tool call repeats 2-3 times, treat it as a loop and stop.
- [ ] Optimise for small models: one tool call at a time, short prompts, 1-2 examples, structured/JSON output where possible, thinking off for specialists.
- [ ] Anything not checked by running it is marked "unverified". Run `bun run typecheck` after every phase.

> Note: the RAG embedding model (`nomic-embed-text-v2-moe`) is separate from the chat agents and is exempt from the single-model rule.

### Phase 0: Cleanup (do this first)

- [ ] Keep the skills-revert changes in one clean commit (`git add -A`, message "revert skills system"); keep the `bin/noni-chan.js` indent change in a separate commit. Why: history should show the removal and the formatting noise separately.
- [ ] Fix the RAG default embed model: use `nomic-embed-text-v2-moe` instead of `nomic-embed-text` in `src/config/Config.ts` and `src/rag/RagStore.ts`, then run `/rag index` for a real test. Why: the old default is not pulled locally, so indexing fails.
- [ ] Launch both TUI and web, then test a chat plus one tool call. Why: this is currently unverified.
- [ ] Add small tests for the agent loop and 2-3 tools, and fix the `bun test` claim in `README.md`. Why: `bun test` currently reports "0 test files".
- [ ] Checkpoints/undo (top TODO item): a way to revert agent-made edits. Why: required before any writer agent can touch files.

### Phase A: Make the Agent reusable

- [ ] `src/agent/Agent.ts` constructor (~line 97): add optional `instructions` (role prompt, appended in `systemPrompt()` ~line 210) and `maxSteps`. Old behaviour must not change. Why: each specialist needs its own role without forking the class.
- [ ] Child Agent takes the parent's current model (`parent.model`). If the user changes `/model`, the next child run uses the new model. Check that `ctxByModel` state (`Agent.ts:89`) still works for that single model. Why: single-model rule; no per-agent model config.
- [ ] Add a `runAndCollect(prompt)` helper that runs a child and returns only the final text (or derive the summary from `messageSink`). Why: the parent needs a compact result, not the child's full transcript.
- [ ] Child loop guard: repeat detection, `maxSteps`, timeout. Why: small models loop; without a brake a child can burn the whole context.

### Phase B: delegate tool v1

- [ ] Agent definitions in `agents/*.md` or JSON. Fields: name, prompt, tools allowlist, `maxSteps`, think, temperature (optional). No `model` field. Why: specialists are data, not code; adding one must not touch `Runtime.ts`.
- [ ] `src/tools/DelegateTool.ts` (new): `delegate { agent, task }`. Creates a new `Agent` instance with empty history, its own `instructions` and the parent's model. No `model` parameter. Why: one tool call is the whole interface the Master needs.
- [ ] Child tool set is read-only only: `read_file`, `list_dir`, `glob`, `grep`, `rag`, `read_docs` (+ optional `web_search`/`web_fetch`). No `bash`, no write/edit tools, no `todo`, no `ask_user`, no `exit_plan`. Why: v1 must not damage the repo or collide with parent state.
- [ ] `src/app/Runtime.ts` (~lines 140-177): tool-instance factory `createToolset(cwd, deps, subset)` so parent and child get separate instances. Register `DelegateTool`. Do not touch `RunLock`. Why: shared tool instances carry shared state (`TodoStore`, `JobManager`, docs); `RunLock` must stay parent-only or children deadlock.
- [ ] `src/plan/PlanGuard.ts`: `delegate` stays blocked in plan mode until the child is guaranteed read-only. `ExitPlanTool` stays parent-only (`Runtime.ts:157`). Why: otherwise plan mode can be bypassed through a child.
- [ ] Parent UI shows one line: "↳ <agent> working" and "↳ <agent> done" at the end. The child's full output stays in a buffer; the parent gets only the final summary. Why: small models produce long traces; the parent context must stay clean.
- [ ] First specialist: `oldman` (read-only advisor/memory). Test whether the Master calls it at the right time. Why: proves the plumbing on the safest possible agent.
- [ ] Add `delegate` to `README.md` and `TOOLS.md`. Why: documented tools get used correctly.

### Phase C: UI

- [ ] `src/ui/Tui.ts`: `SubAgentUI` adapter. Buffer child output and show it as a collapsed card in the parent chat. Dangerous tools are auto-denied. Why: the child must not write into the parent's single readline prompt.
- [ ] Web: `src/server/WebAgentUI.ts` and `src/server/Server.ts` emit `subagent_start` / `subagent_tool` / `subagent_end`. Keep one sink. Why: a second SSE sink would interleave two streams.
- [ ] Web UI: agent cards (spinner, done, error) and status dots in the right panel. Why: the household needs a visible state.

### Phase D: Writer specialists (after checkpoints)

- [ ] Set up checkpoints and confirm routing first (a child's write approval must reach the parent correctly). Why: writer agents can destroy work, and the current confirm path is parent-only.
- [ ] `src/plan/PlanGuard.ts`: give each child its own guard instance. If plan mode is ON, the child is read-only too. Decide `continueCheck` / `PLAN_WRITES` behaviour for children. Why: otherwise a child writes while the parent is in plan mode.
- [ ] Butler (executor, files + shell), Mistri (fixer; same selected model, difference only in prompt and tools), Nanny (creative/small tasks). All tools and prompts live in config.
- [ ] Solve shared state: make `TodoStore`, `JobManager` and `DocsRegistry` per-agent or build them through a factory (`src/app/Runtime.ts`). Why: shared stores collide when two agents run.

### Phase E: Parallel and the household event layer

- [ ] `src/app/OllamaQueue.ts` (new): a semaphore. `class QueuedOllama extends Ollama` overriding `chat`/`embed`/`show`/`list`. The lock is held until the whole stream is consumed. Why: the goal is controlling parallel requests, not avoiding model swaps.
- [ ] Parallel children: `Promise.allSettled` plus `AbortController` for cancellation. First test whether Ollama queues parallel requests on the same model or needs `OLLAMA_NUM_PARALLEL` (unverified), and what it does to RAM. Why: the same model removes the load/unload problem, but parallel requests still affect speed and context memory.
- [ ] Event bus: one `{agent, state, text}` event per agent, feeding both the UI and the household layer. Why: one source of truth for state.
- [ ] Maintenance agent on a timer. Most work in code (loop detector, timeout, log size check); the model only writes the report. Why: small models should not be trusted with the boring parts.
- [ ] Household characters: Master (orchestrator), Butler, Nanny/Maid, Old man (memory via `NONI.md`), Mistri (repair), Maintenance. Mood, chatter, rooms and routines come later.
- [ ] Project memory `NONI.md` (base for Old man) and auto-compaction.

> Note: because every agent runs the selected model, model loading/unloading is no longer a problem; only request concurrency remains.

### Order

Phase 0 -> A -> B -> C -> D -> E. After every phase: typecheck, tests, commit.

### Big risks

1. UI/confirm routing: parallel or writer children will mix prompts and output (solved in Phase C/D).
2. Shared tool state (todo, bash jobs, ask_user): never give a child the parent's instances.
3. Plan mode bypass: a child without a guard can still change files while plan mode is on.
4. CPU/RAM: the same model reduces RAM thrash, but parallel requests still cost speed and context memory; a queue is required.
5. Unverified: Ollama's own parallel-request behaviour (`OLLAMA_NUM_PARALLEL`) and the real CPU/RAM cost have not been tested.

## Gaps vs Claude Code

- [ ] **Subagents / background tasks / worktrees** — currently a single loop, one chat at a time (concurrent requests return 409).
- [ ] **Checkpoints / rewind** — `/rewind` jaisa code + chat rollback.
- [ ] **Sandbox** — OS-level filesystem/network isolation; currently only confirm prompts.
- [ ] **Hooks / plugins** — no lifecycle hooks (before/after tool, stop) or plugin marketplace.
- [ ] **Project memory** — no auto-loaded instruction file equivalent to `CLAUDE.md`.
- [ ] **Code intelligence** — no LSP diagnostics / go-to-definition; depends on grep + read.
- [ ] **GitHub / PR workflow** — only `git add/commit`; no PR create, CI fix, or review commands.
- [ ] **Review commands** — no built-in `/code-review`, `/security-review`, `/simplify` flow.
- [ ] **Editor integration** — no VS Code / JetBrains extension; web client is optional.
- [ ] **Token / usage stats** — local so no cost, but no context/token usage counter.
- [ ] **Fallback models** — no fallback chain when a model fails.

## Smaller

- [ ] Web client: multiple tabs (concurrent requests currently return `409 agent busy`).
- [ ] Streaming TTS in the web client.
- [ ] Session fork / branch / rename (currently only `/history <id>` load).
- [ ] Image support audit — vision path exists, but long image chats consume context; will improve with compaction.
- [ ] Automated test suite — currently verified with `bun run typecheck` + manual runs.

## Done

- [x] Shared runtime for TUI + web (`src/app/Runtime.ts`)
- [x] `noni serve` HTTP/SSE bridge + web client
- [x] SQLite history (sessions + messages), TUI `/history` and web History
- [x] Plan mode: read-only guard, `exit_plan` approval, TUI + web
- [x] Plan-first default (`NONI_PLAN_MODE=off` to disable)
- [x] Approved plan auto-executes todos (nudge on premature stop)
- [x] Retry layers: timeout context shrink, network/5xx backoff, tool-error feedback
