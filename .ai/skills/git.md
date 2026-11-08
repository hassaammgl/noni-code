---
name: git
description: Safe git operations with the git tool, and when to fall back to bash.
---

# Git

Use the `git` tool for everyday work:

| Action | Example |
| --- | --- |
| `status` | `{"action":"status"}` |
| `diff` | `{"action":"diff","path":"src/app"}` or `{"action":"diff","staged":true}` |
| `log` | `{"action":"log","limit":10}` |
| `show` | `{"action":"show","ref":"HEAD"}` |
| `branch` | `{"action":"branch"}` |
| `add` | `{"action":"add","files":["src/app/Runtime.ts"]}` (default: all changes) |
| `commit` | `{"action":"commit","message":"feat: ..."}` |

Rules:

- Only stage and commit what the user asked for. Never commit unrelated changes.
- `commit` is dangerous → confirmation. Read `status`/`diff` first and write a message that
  says **why**, not just what (`fix: avoid duplicate history rows on reload`).
- `push`, `reset`, `rebase`, `tag`, `stash` are not in the tool. If the user asked, use
  `bash` with an explicit command; never force-push without explicit permission.
- Before a commit, run the project's typecheck/test. Broken code does not get committed.
- Conflict or detached HEAD: stop and report the exact state instead of guessing.
