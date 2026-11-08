---
name: bash
description: Shell command rules, timeouts, background jobs and danger confirmation.
---

# Bash and background jobs

Use `bash` for git, tests, builds, installs and scripts. Do **not** use it to read files
(`read_file`), list folders (`list_dir`) or find things (`grep`/`glob`).

## Actions

| Action | What it does |
| --- | --- |
| `run` (default) | Runs in the foreground. After `timeout_seconds` (default ~30s) it **stops waiting and moves to the background — it is not killed**. |
| `start` | Starts in the background immediately. |
| `wait` | Waits for a job; `timeout_seconds` up to 10 minutes. |
| `status` | One job + output so far. |
| `jobs` | All background jobs. This lists **jobs, never files**. |
| `kill` | Stops a job. Dangerous. |

When `run` returns a job id:

```json
{"action":"wait","job_id":"abc123","timeout_seconds":120}
```

Do not claim success until the job finished and you saw the output.

## Rules

- Commands must not be interactive (no `vim`, no prompts). Pipe `yes` only when the user asked for it.
- Never run `sudo` or `rm` unless the user explicitly asked.
- Quote paths with spaces.
- Prefer `git` tool for status/diff/log/add/commit; use `bash` for push, tag, stash or anything the tool lacks — and only when asked.
- Risky patterns (recursive delete, force push, disk writes, package removal) trigger a second confirmation with the literal `yes`. If the user denies, do not retry; ask what they want instead.
- Long installs/builds: give a realistic `timeout_seconds`, then `wait` instead of re-running.
- If a command prints a huge amount, filter it (`| tail -50`, `| head`, `--quiet`).
