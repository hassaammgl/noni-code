---
name: workflow
description: How to plan multi-step work, track it with todo, verify it, and keep the repo clean.
---

# Workflow

## Plan first, for real work

Use the `todo` tool when the task has 3+ steps or touches more than one file.

```json
{"action":"plan","outline":"1. Build login\n  1.1 HTML form\n  1.2 Validation\n2. Test"}
```

- Two spaces = subtask. `tasks` (nested array) is an alternative to `outline`.
- A plan already exists → `action=add` for new work, or `action=plan` with `replace=true` to consciously rewrite it.
- Work one leaf at a time: `action=next` → do the work with other tools → `action=done` with the id.
- Discovered something mid-way → `action=add` with `parent_id`; do not keep it in your head.
- Blocked → `{"action":"update","id":"1.2","status":"blocked","notes":"why"}` and say why.
- Simple one-step tasks do not need a plan.

Progress output tells you the next step; trust it over memory.

## Plan mode

When plan mode is ON you are read-only: no file writes, no commands, no installs, no commits.

1. Investigate with `read_file`, `list_dir`, `glob`, `grep`, `rag`, `read_docs`, `web_search`, `web_fetch`, `git status/diff/log/show`, `system_info`, `todo`, `skill`.
2. Do not ask for permission for every read. Build the full picture first.
3. Submit the plan with `exit_plan {"plan":"1. ...\n  1.1 ..."}`. Be specific about files, changes and verification.
4. If the user rejects it, ask what to change and call `exit_plan` again. Nothing was modified.
5. After approval the mode is OFF and the plan is in the todo list. Execute it yourself, all the way through: `todo action=next` -> do the step -> `todo action=done` -> next. Do not stop to ask for permission between steps; stop only when every todo is done or something blocks you. File edits inside the approved plan are already allowed; commands may still ask for confirmation.

If the user asks for an edit while plan mode is on, say plan mode is active and present the plan instead.

## Look before you build

1. `list_dir` / `glob` the area. Follow the existing layout and naming.
2. `grep` for similar code before inventing a new pattern.
3. Read the files you are about to change.
4. Put new code where its neighbours live. App code in `src/`, throwaway tests in `test/<name>/` with its own README and build file. Never dump files at the repo root.

## Verify before saying done

- Code must compile: run the project's typecheck/build.
- Run the test or the program. If it fails, fix it before replying.
- Async/long commands: `bash` may return a job id. It is still running, not killed. Use `bash {"action":"wait","job_id":"..."}`, or do an independent subtask and come back. Do not mark the todo done until it finishes.
- State exactly what you checked. "Typecheck passes, tests green" is verification. "Looks right" is not.

## Keep it clean

- No empty folders, stray scripts or half-written files. Remove what you created and no longer need.
- If a file exists, read it first. If it is broken, fix it; do not add a copy.
- Never edit, write or delete anything the user did not ask for. Suggest and wait.
- Finish with: what changed, what was verified, and the one next step worth taking.
