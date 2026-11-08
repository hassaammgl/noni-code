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
- **Images (vision)** — `/img <path>` se agla message image ke saath model ko jata hai (vision-supporting models pe).
- **Update check** — startup pe aur long sessions me har 6h npm pe naya version dekhta hai; `/update` se manual.
- **Web client** — optional React VRM avatar + voice + chat UI (`client/`), `noni serve` ke local bridge se wahi agent/tools chalata hai.
- **History** — har chat SQLite me save hoti hai; TUI `/history` aur web History button se wapas kholo.
- **Skills (`.ai`)** — tool/flow instructions markdown packs me; prompt me sirf index, poora text on demand.
- **Plan mode** — `/plan` se read-only investigation; agent plan deta hai, approve karne par hi edits chalte hain.
- **Small-model friendly TUI** — compact output, previews before risky edits, spinner with elapsed time.

## Commands

| Command | Kaam |
|---|---|
| `/help` | command list |
| `/tools` | tools and dangerous markers |
| `/todos` | current task tree |
| `/todos clear` | clear the plan |
| `/jobs` | background jobs |
| `/jobs kill <id>` | stop a background job |
| `/img <path>` | image attach karo — agli message ke saath jayegi |
| `/img clear` | pending image hatao |
| `/model <name>` | switch model |
| `/history [id]` | saved sessions list karo / load karo |
| `/skills` | `.ai` skills list karo |
| `/skills <name>` | ek skill ka content dekho |
| `/skills reload` | skills disk se dobara padho |
| `/plan [on\|off]` | read-only plan mode; approve karne par tools khulte hain |
| `/clear` | chat clear — naya session |
| `/think` | toggle model thinking |
| `/client on [port]` | web UI server **usi process** me start karo (default 4317) |
| `/client off` | web UI server band karo |
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
| `ask_user` | model ambiguous ho to guess karne ki jagah poochhta hai |
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
ye error screenshot me kya hai?
```

- Sirf vision wale models (jaise `qwen3.5`) — Ollama `capabilities` se check hota hai, warna saaf error.
- Max 10 MB, aur file `image/*` honi chahiye (extension/mime se).
- `/img clear` pending image hata deta hai; `/clear` chat ke saath image bhi reset karta hai.
- Logs me sirf path aur size jata hai — base64 kabhi log nahi hota.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama API |
| `OLLAMA_MODEL` | — | skip the model picker |
| `OLLAMA_NUM_CTX` | `llm.num_ctx` in config (default `"max"`) | context window override |
| `OLLAMA_NUM_PREDICT` | `4096` | max generated tokens |
| `OLLAMA_TEMPERATURE` | `0.4` | sampling temperature |
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG instance |
| `NONI_NO_UPDATE_CHECK` | — | `1` = update checks skip (offline/CI ke liye) |
| `NONI_UPDATE_INTERVAL_MS` | `21600000` (6h) | long session me dobara check ka interval |
| `NONI_HISTORY_DB` | `~/.local/share/noni-chan/history.db` | SQLite chat history path |
| `NONI_PLAN_MODE` | `on` | plan-first default; `off` = startup se write tools enabled |
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

`disabled: true` wale servers skip ho jate hain. File na ho to app bina MCP tools ke chalti hai.

Same file me model defaults bhi hain — context length by default har model ki max hoti hai:

```json
{
  "llm": { "num_ctx": "max" },
  "mcp": { "servers": {} }
}
```

`num_ctx` ko number (jaise `32768`) kar do to usi value pe cap ho jayegi. `OLLAMA_NUM_CTX` env isse bhi upar hai (emergency override).

## Web client (`noni serve`)

Browser UI (`client/` — VRM avatar + voice + chat) agent ko local HTTP/SSE bridge se chalata hai: history, tool cards, confirm dialogs aur voice, sab ek jagah. Animation tester dashboard hata diya hai; idle/motions khud chalti rehti hain.

**TUI se hi on/off (same process, same agent):**

```text
/client on          # default http://127.0.0.1:4317
/client on 5000     # custom port
/client off         # server band
/client             # status
```

**Ya alag process me:**

```bash
bun run serve              # http://127.0.0.1:4317
bun run serve --port 5000  # ya NONI_PORT=5000
```

- Server sirf **127.0.0.1** pe bind hota hai; default me koi token nahi.
- `client/dist` build ho to **`http://127.0.0.1:4317/`** pe UI khud serve hoti hai; build na ho to setup page dikhta hai.
- UI build: `cd client && bun install && bun run build` (UI change ke baad dobara).
- Hot-reload dev ke liye: `cd client && bun run dev` → `http://localhost:5173` (`VITE_NONI_URL` se server URL).
- `NONI_SERVE_TOKEN=secret` set karo to client ko `x-noni-token` header bhejna hoga.
- CORS sirf localhost origins (+ `NONI_SERVE_ORIGIN`) allow karta hai.
- Endpoints: `GET /api/health`, `/api/state`, `/api/models`; `POST /api/chat` (SSE), `/api/confirm`, `/api/answer`, `/api/model`, `/api/clear`.
- Dangerous tools ka confirm server-side hi enforce hota hai — browser sirf allow/deny bhejta hai.
- TUI aur web ek waqt me ek hi run chalate hain; dusra try kare to busy warning milti hai.

## History

Har user/assistant message SQLite me save hota hai:

- Default: `~/.local/share/noni-chan/history.db` (`NONI_HISTORY_DB` se badal sakte ho)
- TUI: `/history` list, `/history <id>` load, `/clear` naya session
- Web: **History** button, **+ New** naya chat
- TUI aur web same DB share karte hain

## Skills (`.ai`)

Persona chhoti rehti hai; tool/flow ki detail `.ai/skills/` me markdown packs ke roop me rehti hai.

- System prompt me sirf **index** jata hai (`- name: one-line description`).
- Agent zarurat par `skill {"action":"read","name":"tools"}` se poora text load karta hai.
- Built-in skills: `tools`, `workflow`, `bash`, `files`, `docs`, `web`, `git`, `security`, `aiml`, `research`.
- Apni skill add karo: `<project>/.ai/skills/mera-skill.md` (frontmatter: `name`, `description`).
- Priority: `<project>/.ai` → `~/.config/noni-chan/.ai` → package `.ai` → `NONI_SKILLS_DIR`.
- TUI: `/skills`, `/skills <name>`, `/skills reload`.

Format aur examples: `.ai/README.md`.

## Plan mode

Plan-first **default ON** hai: startup pe agent read-only hota hai. `/plan off` se band karo, ya poora default hi badalna ho to `NONI_PLAN_MODE=off` set karo.

`/plan` se read-only planning on/off hota hai (web UI me **Plan** button). Flow:

1. Agent sirf read tools use karta hai — `read_file`, `list_dir`, `glob`, `grep`, `read_docs`, `web_search`, `web_fetch`, `git status/diff/log/show`, `system_info`, `todo`, `skill`.
2. Jab picture clear ho, wo `exit_plan` tool se nested plan deta hai.
3. TUI `y/N` poochta hai; web me **Approve & execute** modal aata hai.
4. Approve → plan mode OFF, plan todo list ban jata hai, aur agent **khud poora plan execute karta hai** — `todo next` → step → `done` → next, beech me permission maangne ke liye nahi rukta. Reject → mode ON rehta hai, agent plan revise karta hai.

Blocked cheezein: `write_file`, `edit_file`, `replace_lines`, `delete_file`, `move_file`, `make_dir`, `bash run/start/kill`, `git add/commit`, aur MCP tools.

Approved plan ke andar file edits (`write_file`, `edit_file`, `replace_lines`, `delete_file`, `move_file`, `make_dir`) dobara Allow nahi maangte — plan approval hi unka approval hai. `bash`, `git commit` jaise commands phir bhi confirm karte hain.

## Retries

- **Plan auto-run** — approved plan ke todos bache hon aur model ruk jaye, to runtime khud "continue" nudge bhejta hai (max 10). Uske baad `plan auto-run paused` warning aata hai.
- **Timeout** — Ollama request/stream timeout par `num_ctx` aadha karke wahi request dobara chalti hai (minimum 4096).
- **Network / 5xx** — `ECONNREFUSED`, `ECONNRESET`, `fetch failed`, 429/500/502/503/504 par 3 attempts, 400ms × attempt backoff. Sirf tab jab abhi koi content stream na hua ho, taake duplicate text na dikhe.
- **Tool failure** — tool ka error model ko wapas jata hai; wo khud doosra approach leta hai. User ne deny kiya to retry nahi hota.
- **Sab fail ho jaye** — error UI me aata hai; plan adhoora ho to `continue` bhej kar resume karo.

Roadmap aur bache hue gaps: [`TODO.md`](TODO.md).

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


lets add image feature becuse its already in this model lets add this feature or first history feature what do u think 
import ollama from 'ollama'

const imagePath = '/absolute/path/to/image.jpg'
const response = await ollama.chat({
  model: 'gemma4',
  messages: [
    { role: 'user', content: 'What is in this image?', images: [imagePath] }
  ],
  stream: false,
})

console.log(response.message.content)