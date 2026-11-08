# TODO

Roadmap for Noni. Ordered by impact, not by effort.

## Next

- [ ] **Checkpoints / undo** — snapshot files before each edit; `/undo` rolls back code + conversation. Without this, there is no direct way to revert agent-made file changes.
- [ ] **Subagents** — a tool that works in a separate context and returns a summary. Enables parallel tasks, less context pollution, and cheaper long investigations.
- [ ] **Project memory** — auto-load `<project>/NONI.md` (hierarchy: project → `~/.config/noni-chan/NONI.md`) so the same instructions don't need to be repeated every session.
- [ ] **Permission rules** — allow/ask/deny rules per tool/command in `.noni/settings.json`; currently only per-call confirm + plan guard exist.
- [ ] **Auto-compaction** — summarize older turns before context fills; reduce the need for manual `/clear`.
- [ ] **Headless mode** — `noni -p "prompt"` + JSON/stream output for CI and scripts (`serve.ts` is currently HTTP-only).

## Gaps vs Claude Code

- [ ] **Subagents / background tasks / worktrees** — currently a single loop, one chat at a time (concurrent requests return 409).
- [ ] **Checkpoints / rewind** — `/rewind` jaisa code + chat rollback.
- [ ] **Sandbox** — OS-level filesystem/network isolation; currently only confirm prompts.
- [ ] **Hooks / plugins** — no lifecycle hooks (before/after tool, stop) or plugin marketplace.
- [ ] **Project memory** — no auto-loaded instruction file equivalent to `CLAUDE.md`.
- [ ] **Code intelligence** — no LSP diagnostics / go-to-definition; depends on grep + read.
- [ ] **GitHub / PR workflow** — only `git add/commit`; no PR create, CI fix, or review commands.
- [ ] **Review commands** — no built-in `/code-review`, `/security-review`, `/simplify` flow (possible manually via skills).
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
- [x] `.ai` skills system (index in prompt, body on demand, 10 built-in packs)
- [x] Plan mode: read-only guard, `exit_plan` approval, TUI + web
- [x] Plan-first default (`NONI_PLAN_MODE=off` to disable)
- [x] Approved plan auto-executes todos (nudge on premature stop)
- [x] Retry layers: timeout context shrink, network/5xx backoff, tool-error feedback
