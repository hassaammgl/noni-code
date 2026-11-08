# noni-chan

**Agentic coding CLI for the terminal.** Local Ollama models, web search, docs-aware edits, nested todos, background jobs, MCP tools, and a small-model-friendly TUI.

Noni runs on [Bun](https://bun.sh). The npm wrapper starts it for you.

## Quick start

Requirements:

- **Bun** 1.1+
- **Ollama** running locally (`ollama serve`)
- Optional: **SearXNG** for web search (DuckDuckGo fallback works without it)

```bash
# Bun install (if you don't have it)
curl -fsSL https://bun.sh/install | bash

# install Noni
npm install -g noni-chan

# or run without installing
npx noni-chan
```

Pull a model if needed:

```bash
ollama pull qwen3.5:0.8b
noni-chan
```

First launch shows a model picker. `Enter` picks the smallest installed chat model.

## Features

- **Local-first** — talks to Ollama; no cloud key required.
- **Model picker** — choose at startup or switch with `/model`.
- **Web search + fetch** — SearXNG first, DuckDuckGo fallback, readable page extraction.
- **Docs guard** — blocks JS/TS/Python edits that add a new third-party import until `read_docs` was called.
- **Nested todos** — plan tasks and subtasks, iterate with `next`/`done`.
- **Background jobs** — long builds keep running; wait, check status, or kill them.
- **MCP tools** — load extra tools from the global config `~/.config/noni-chan/config.json`.
- **Images (vision)** — `/img <path>` attaches an image to the next message (vision-capable models).
- **Update check** — checks npm for a new version at startup and every 6 hours in long sessions; `/update` runs a manual check.
- **Web client** — optional React VRM avatar + voice + chat UI (`client/`), driven by the same agent/tools through a local `noni serve` bridge.
- **History** — every chat is saved to SQLite; reopen with TUI `/history` or the web History button.
- **Skills (`.ai`)** — tool/flow instructions as markdown packs; the prompt includes only an index, with full text loaded on demand.
- **Plan mode** — `/plan` enables read-only investigation; the agent proposes a plan and edits run only after approval.
- **Small-model friendly TUI** — compact output, previews before risky edits, spinner with elapsed time.

## Commands

| Command | Description |
|---|---|
| `/help` | command list |
| `/tools` | tools and dangerous markers |
| `/todos` | current task tree |
| `/todos clear` | clear the plan |
| `/jobs` | background jobs |
| `/jobs kill <id>` | stop a background job |
| `/img <path>` | attach an image to the next message |
| `/img clear` | remove the pending image |
| `/model <name>` | switch model |
| `/history [id]` | list or load saved sessions |
| `/skills` | list `.ai` skills |
| `/skills <name>` | view a skill's content |
| `/skills reload` | reload skills from disk |
| `/plan [on\|off]` | read-only plan mode; tools unlock after approval |
| `/clear` | clear chat — start a new session |
| `/think` | toggle model thinking |
| `/client on [port]` | start the web UI server in the **same process** (default 4317) |
| `/client off` | stop the web UI server |
| `/client` | client status + usage |
| `/update` | check npm for a newer version |
| `/exit` | quit |

## Tools

| Tool | What it does |
|---|---|
| `read_file`, `list_dir` | read files / list folders |
| `write_file`, `edit_file`, `replace_lines`, `delete_file` | modify workspace files (confirm + preview) |
| `move_file`, `make_dir` | rename/move files, create folders |
| `git` | `status`/`diff`/`log`/`show`/`branch` + `add`/`commit` (no push) |
| `ask_user` | asks the user when the request is ambiguous instead of guessing |
| `bash` | shell commands; long ones move to background jobs |
| `glob`, `grep` | find files / search contents |
| `web_search`, `web_fetch` | search and read pages |
| `read_docs` | local package → pydoc/go doc/man/headers → npm/PyPI → web |
| `todo` | nested plan: `plan`, `add`, `next`, `done`, `update`, `remove`, `clear` |
| `system_info` | OS, CPU, RAM, disk, battery, uptime |
| MCP tools | anything enabled in `~/.config/noni-chan/config.json` |

### Docs guard

A JS/TS/Python file that newly imports a third-party package is blocked until you call:

```json
{"name":"zod","language":"js"}
```

- C/C++ files are exempt.
- Python stdlib and local modules are exempt.
- If docs cannot be found, the library is marked read so the agent is not deadlocked.
- Each package is blocked at most twice, then the edit is allowed.

### Todos

```json
{"action":"plan","outline":"1. Build API\n  1.1 Routes\n  1.2 Validation\n2. Test"}
```

```json
{"action":"next"}
{"action":"done","id":"1.1"}
{"action":"add","parent_id":"1","title":"Error handling"}
```

### Background jobs

`bash` waits 30s by default. If a command is still running, it is **not killed** — it becomes a job:

```json
{"action":"wait","job_id":"1","timeout_seconds":120}
{"action":"status","job_id":"1"}
{"action":"jobs"}
{"action":"kill","job_id":"1"}
```

The agent can work on other todos while a job runs. Jobs are stopped when the app exits.

`action=jobs` lists background jobs only. For folders use the `list_dir` tool; for files use `read_file`, `glob` or `grep`.

### Images

```
/img ~/Pictures/screenshot.png
what is the error in this screenshot?
```

- Vision-capable models only (e.g. `qwen3.5`) — checked via Ollama `capabilities`; otherwise a clear error is shown.
- Max 10 MB, and the file must be an image (`image/*` by extension/MIME).
- `/img clear` removes the pending image; `/clear` also resets it with the chat.
- Logs include only path and size — base64 is never logged.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama API |
| `OLLAMA_MODEL` | — | skip the model picker |
| `OLLAMA_NUM_CTX` | `llm.num_ctx` in config (default `"max"`) | context window override |
| `OLLAMA_NUM_PREDICT` | `4096` | max generated tokens |
| `OLLAMA_TEMPERATURE` | `0.4` | sampling temperature |
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG instance |
| `NONI_NO_UPDATE_CHECK` | — | `1` = skip update checks (for offline/CI) |
| `NONI_UPDATE_INTERVAL_MS` | `21600000` (6h) | recheck interval in long sessions |
| `NONI_HISTORY_DB` | `~/.local/share/noni-chan/history.db` | SQLite chat history path |
| `NONI_PLAN_MODE` | `on` | plan-first default; `off` = enable write tools at startup |
| `NONI_SKILLS_DIR` | — | extra skills folder(s), `:` se separated |

MCP servers come from the global config at `~/.config/noni-chan/config.json` (or `$XDG_CONFIG_HOME/noni-chan/config.json`):

```json
{
  "mcp": {
    "servers": {
      "my-server": {
        "command": "npx",
        "args": ["-y", "some-mcp-server"],
        "env": { "TOKEN": "..." },
        "disabled": false
      }
    }
  }
}
```

Servers with `disabled: true` are skipped. If the file is missing, the app runs without MCP tools.

The same file can set model defaults — by default, context length uses each model's maximum:

```json
{
  "llm": { "num_ctx": "max" },
  "mcp": { "servers": {} }
}
```

Set `num_ctx` to a number (e.g. `32768`) to cap it at that value. The `OLLAMA_NUM_CTX` env var overrides this (emergency override).

## Web client (`noni serve`)

The browser UI (`client/` — VRM avatar + voice + chat) drives the agent through a local HTTP/SSE bridge: history, tool cards, confirm dialogs, and voice in one place. The animation tester dashboard was removed; idle/motions run automatically.

**Toggle from the TUI (same process, same agent):**

```text
/client on          # default http://127.0.0.1:4317
/client on 5000     # custom port
/client off         # stop server
/client             # status
```

**Or in a separate process:**

```bash
bun run serve              # http://127.0.0.1:4317
bun run serve --port 5000  # or NONI_PORT=5000
```

- The server binds only to **127.0.0.1**; no token is required by default.
- If `client/dist` is built, the UI is served at **`http://127.0.0.1:4317/`**; otherwise a setup page is shown.
- Build the UI: `cd client && bun install && bun run build` (rebuild after UI changes).
- For hot-reload dev: `cd client && bun run dev` → `http://localhost:5173` (server URL via `VITE_NONI_URL`).
- Set `NONI_SERVE_TOKEN=secret` to require the client to send an `x-noni-token` header.
- CORS allows only localhost origins (+ `NONI_SERVE_ORIGIN`).
- Endpoints: `GET /api/health`, `/api/state`, `/api/models`; `POST /api/chat` (SSE), `/api/confirm`, `/api/answer`, `/api/model`, `/api/clear`.
- Dangerous tool confirmation is enforced server-side — the browser only sends allow/deny.
- The TUI and web run one agent task at a time; a concurrent request returns a busy warning.

## History

Every user/assistant message is saved to SQLite:

- Default: `~/.local/share/noni-chan/history.db` (override with `NONI_HISTORY_DB`)
- TUI: `/history` list, `/history <id>` load, `/clear` starts a new session
- Web: **History** button, **+ New** naya chat
- The TUI and web share the same DB

## Skills (`.ai`)

The persona stays small; tool/flow details live as markdown packs in `.ai/skills/`.

- The system prompt includes only an **index** (`- name: one-line description`).
- The agent loads full text on demand with `skill {"action":"read","name":"tools"}`.
- Built-in skills: `tools`, `workflow`, `bash`, `files`, `docs`, `web`, `git`, `security`, `aiml`, `research`.
- Add your own skill: `<project>/.ai/skills/my-skill.md` (frontmatter: `name`, `description`).
- Priority: `<project>/.ai` → `~/.config/noni-chan/.ai` → package `.ai` → `NONI_SKILLS_DIR`.
- TUI: `/skills`, `/skills <name>`, `/skills reload`.

Format and examples: `.ai/README.md`.

## Plan mode

Plan-first is **ON by default**: the agent starts read-only. Use `/plan off` to disable, or set `NONI_PLAN_MODE=off` to change the default.

`/plan` toggles read-only planning (web UI: **Plan** button). Flow:

1. The agent uses only read tools — `read_file`, `list_dir`, `glob`, `grep`, `read_docs`, `web_search`, `web_fetch`, `git status/diff/log/show`, `system_info`, `todo`, `skill`.
2. When the picture is clear, it submits a nested plan via the `exit_plan` tool.
3. The TUI asks `y/N`; the web UI shows an **Approve & execute** modal.
4. Approve → plan mode OFF, the plan becomes a todo list, and the agent **executes the full plan** — `todo next` → step → `done` → next, without stopping to ask for permission between steps. Reject → mode stays ON and the agent revises the plan.

Blocked actions: `write_file`, `edit_file`, `replace_lines`, `delete_file`, `move_file`, `make_dir`, `bash run/start/kill`, `git add/commit`, and MCP tools.

Within an approved plan, file edits (`write_file`, `edit_file`, `replace_lines`, `delete_file`, `move_file`, `make_dir`) do not ask for Allow again — plan approval covers them. Commands like `bash` and `git commit` still require confirmation.

## Retries

- **Plan auto-run** — if an approved plan still has todos and the model stops, the runtime sends a "continue" nudge (max 10). After that, a `plan auto-run paused` warning appears.
- **Timeout** — on an Ollama request/stream timeout, the request retries with `num_ctx` halved (minimum 4096).
- **Network / 5xx** — `ECONNREFUSED`, `ECONNRESET`, `fetch failed`, 429/500/502/503/504 retry 3 times with 400ms × attempt backoff. Only when no content has streamed yet, to avoid duplicate text.
- **Tool failure** — the tool error is returned to the model, which tries a different approach. If the user denied the action, it is not retried.
- **All retries fail** — the error appears in the UI; if a plan is incomplete, send `continue` to resume.

Roadmap and remaining gaps: [`TODO.md`](TODO.md).

## Local development

```bash
bun install
bun run dev      # watch mode
bun run start    # run once
bun test
bun run typecheck
```

Project layout:

```
index.ts              TUI entry point + command loop
serve.ts              `noni serve` HTTP/SSE entry
src/app/              shared runtime (agent + tools) and model picker
src/history/          SQLite chat history (sessions + messages)
src/plan/             plan mode switch + read-only guard
src/skills/           `.ai` skill loader (index in prompt, body on demand)
src/server/           web bridge (SSE + confirm/ask + static client)
src/agent/            agent loop, guards, persona
src/tools/            built-in tools
src/docs/             docs sources + DocsGuard
src/todos/            nested task store
src/jobs/             background job manager
src/search/           search providers + fallback engine
src/ui/               terminal UI
.ai/                  skill packs (markdown instructions)
client/               React VRM avatar + voice + chat UI (optional)
test/                 unit + integration tests
```

## Troubleshooting

**`noni-chan: command not found`** — install globally with `npm i -g noni-chan`, or run `npx noni-chan`.

**Bun is missing** — the npm wrapper prints the install command. Install Bun from https://bun.sh.

**Ollama not reachable** — start it with `ollama serve` and check `curl http://127.0.0.1:11434/api/tags`.

**Old version from `npx`** — npm caches packages. Force it:

```bash
npx --yes noni-chan@latest
# or
npm cache clean --force
```

**Replies cut short** — the model hit its context/output limit. Use `/clear`, raise `OLLAMA_NUM_CTX`, or raise `OLLAMA_NUM_PREDICT`.

## Limitations

- Ollama is the only provider right now (no Anthropic/Gemini/OpenAI adapters yet).
- Images need a vision model (checked via Ollama `capabilities`). Image data is base64 in memory, never in logs; older images stay in the chat history, so long image chats eat context — `/clear` resets.
- The docs guard sees import lines, not every dynamic API use.
- Very small models can still produce malformed tool calls. 2B+ models are more reliable.
