# TODO

Roadmap for Noni. Ordered by impact, not by effort.

## Next

- [ ] **Checkpoints / undo** — every edit ke pehle file snapshot; `/undo` se code + conversation rollback. Bina iske agent ke badle hue files wapas karne ka seedha raasta nahi hai.
- [ ] **Subagents** — ek tool jo alag context me kaam karke summary wapas de. Parallel tasks, context pollution kam, lambi investigations sasti.
- [ ] **Project memory** — `<project>/NONI.md` auto-load (hierarchy: project → `~/.config/noni-chan/NONI.md`), taake har session me same instructions dobara na likhni pade.
- [ ] **Permission rules** — `.noni/settings.json` me allow/ask/deny rules per tool/command; abhi sirf har call pe confirm + plan guard hai.
- [ ] **Auto-compaction** — context bharne se pehle purane turns summarize karo; manual `/clear` ki zaroorat kam ho.
- [ ] **Headless mode** — `noni -p "prompt"` + JSON/stream output, CI aur scripts ke liye (`serve.ts` abhi HTTP-only hai).

## Gaps vs Claude Code

- [ ] **Subagents / background tasks / worktrees** — abhi single loop, ek waqt me ek chat (dusra request 409).
- [ ] **Checkpoints / rewind** — `/rewind` jaisa code + chat rollback.
- [ ] **Sandbox** — OS-level filesystem/network isolation; abhi sirf confirm prompts.
- [ ] **Hooks / plugins** — lifecycle hooks (before/after tool, stop) aur plugin marketplace nahi.
- [ ] **Project memory** — `CLAUDE.md` jaisa auto-loaded instruction file nahi.
- [ ] **Code intelligence** — LSP diagnostics / go-to-definition nahi; grep + read par depend.
- [ ] **GitHub / PR workflow** — `git add/commit` bas; PR create, CI fix, review commands nahi.
- [ ] **Review commands** — `/code-review`, `/security-review`, `/simplify` jaisa built-in flow nahi (skills se manually ho sakta hai).
- [ ] **Editor integration** — VS Code / JetBrains extension nahi; web client optional hai.
- [ ] **Token / usage stats** — local hai isliye cost nahi, par context/token usage ka koi counter nahi.
- [ ] **Fallback models** — ek model fail ho to doosra try karne ki chain nahi.

## Smaller

- [ ] Web client: multiple tabs (abhi dusra request `409 agent busy`).
- [ ] Streaming TTS in the web client.
- [ ] Session fork / branch / rename (abhi sirf `/history <id>` load).
- [ ] Image support audit — vision path hai, par long image chats context kha jati hain; compaction ke saath fix hoga.
- [ ] Automated test suite — abhi verification `bun run typecheck` + manual runs.

## Done

- [x] Shared runtime for TUI + web (`src/app/Runtime.ts`)
- [x] `noni serve` HTTP/SSE bridge + web client
- [x] SQLite history (sessions + messages), TUI `/history` and web History
- [x] `.ai` skills system (index in prompt, body on demand, 10 built-in packs)
- [x] Plan mode: read-only guard, `exit_plan` approval, TUI + web
- [x] Plan-first default (`NONI_PLAN_MODE=off` to disable)
- [x] Approved plan auto-executes todos (nudge on premature stop)
- [x] Retry layers: timeout context shrink, network/5xx backoff, tool-error feedback
