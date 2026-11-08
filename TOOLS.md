# Tools roadmap

Priority order. Status is checked against the code, not against the plan.

Legend: ✅ in code · ⚠️ listed as done but missing from code · ⬜ not started

## Ban chuke hain

| Tool | Dangerous? | Status |
|---|---|---|
| `read_file` | no | ✅ |
| `list_dir` | no | ✅ |
| `write_file` (overwrites) | yes | ✅ |
| `edit_file` | yes | ✅ |
| `replace_lines` (1-based line range → `new_content`; empty = delete, `end_line = start_line - 1` = insert) | yes | ✅ |
| `delete_file` | yes | ✅ |
| `system_info` (OS, CPU, RAM, disk, battery, uptime) | no | ✅ |
| `web_search` (SearXNG, DuckDuckGo fallback) | no | ✅ |
| `web_fetch` (HTML → text, truncated) | no | ✅ |
| `read_docs` (installed package → pydoc/go doc/man/headers → npm/PyPI → web) | no | ✅ |
| `DocsGuard` (blocks new third-party imports until `read_docs`, 2 blocks max) | — | ✅ |
| `todo` (nested plan, `next`/`done` iteration, `/todos` view) | no | ✅ |
| `skill` (`.ai/skills` se instructions on demand; `/skills` view) | no | ✅ |
| `exit_plan` (plan mode: plan approve karke read-only se bahar) | no | ✅ |
| `jobs` (background bash jobs, `/jobs`, `wait`/`status`/`kill`) | kill yes | ✅ |
| MCP tools (from `~/.config/noni-chan/config.json`) | yes | ✅ code |

Note: `write_file` currently overwrites existing files, it is not "new file only".

## Phase 1 — sabse zaroori

| Tool | Kaam | Dangerous? | Status |
|---|---|---|---|
| `bash` | terminal command chalana; timeout pe process **kill nahi**, background job ban jata hai (`wait`/`status`/`list`/`kill`, `/jobs`); warnings + literal `yes` confirm | yes | ✅ |
| `grep` | poore project me text dhoondhna (regex/literal, glob filter, binary skip) | no | ✅ |
| `glob` | pattern se files dhoondhna (`src/**/*.ts`) | no | ✅ |

Ye teeno milke Claude Code ka asli feel dete hain. Pehle yahi lagne chahiye.

## Phase 2 — kaam ko behtar banane wale

| Tool | Kaam | Dangerous? | Status |
|---|---|---|---|
| `move_file` (missing parent dirs auto-create, destination overwrite nahi) | yes | ✅ |
| `make_dir` | folder banana | yes | ✅ |
| `git` (status/diff/log/show/branch + add/commit; push/reset jaan bujh ke nahi) | commit pe yes | ✅ |
| `todo` | model apni task list khud likhe aur update kare, lambi tasks me kaam aata hai | no | ✅ (upar) |
| `ask_user` | model confusion me ho to user se sawaal puchhe, guess na kare | no | ✅ |

## Phase 3 — smart/agent features

| Tool | Kaam | Dangerous? | Status |
|---|---|---|---|
| `memory` | user ki cheezein save/recall (jaise project setup) | write pe yes | ⬜ |
| `run_tests` | test command chalake result ka chhota summary dena | yes | ⬜ |
| `diagnostics` | `tsc --noEmit` chalake errors dena, taake model apne edit ke baad khud check kare | no | ⬜ |
| `sub_agent` | chhote kaam alag model/context me bhejna | depends | ⬜ |

## Tools ke saath alag cheezein bhi chahiye

Ye tools nahi hain, lekin inke bina tools theek se kaam nahi karenge:

- **Context trimming** — `bash` ka output 10k chars pe truncate hota hai (6k head + 4k tail), memory cap 500k. `web_fetch` ke liye bhi yahi chahiye.
- **Streaming** — ✅ done, `Agent.run` ab `stream: true` se token-by-token print karta hai.
- **`/think` ka reasoning dikhana** — ✅ done, thinking dim `⋯` ke saath stream hota hai.
- **Permission rules** — jaise "`git status` hamesha allow, `rm` kabhi nahi", har command pe `y/N` thak jata hai.

## Build order (meri raay)

`bash` → `grep` + `glob` → `diagnostics` → `git` → baaqi.

`diagnostics` chhota hai lekin kaafi kaam ka, kyunke model apne edit ki galti khud pakad leta hai. Chhote model ke liye ye bada fark dalta hai.

## Guardrail: tool count

Tools zyada hone se chhota model confuse hota hai. 0.8B–3B model 5–8 tools tak theek chalta hai, usse zyada pe galat tool choose karne lagta hai.

- Jab tak bada model na ho, sab tools ek saath on mat karo.
- Future: `/tools on|off` jaisa command.

## Rules for adding a tool

1. Create a class in `src/tools/` extending `Tool`.
2. Set `name`, `description`, `parameters` (JSON schema), and `override dangerous = true` if it writes, deletes, runs commands, or reaches the network.
3. `run(args)` returns a short string; `Agent` wraps failures as `Error: ...`.
4. Keep file paths inside the workspace (`FileTool` base class handles this).
5. Register it in `index.ts` inside `agent.addTools(...)`.
6. Run `bunx tsc --noEmit` before calling it done.
