---
name: files
description: Choosing between read/edit/write tools and editing files safely.
---

# Files

| Need | Tool |
| --- | --- |
| Read a file | `read_file` (shows line numbers) |
| Create or fully replace | `write_file` (overwrites; dangerous) |
| Change a unique snippet | `edit_file` (dangerous) |
| Change a line range | `replace_lines` (1-based, inclusive; dangerous) |
| Rename/move | `move_file` |
| New folder | `make_dir` |
| Remove | `delete_file` (dangerous) |

## Editing

- `read_file` first. Line numbers in `grep` output match `replace_lines` input.
- `edit_file` needs `old_string` to occur **exactly once**. Add surrounding context to
  disambiguate; never guess.
- `replace_lines`: empty `new_content` deletes the range; `end_line = start_line - 1`
  inserts before `start_line`.
- Keep the file's existing style: quotes, semicolons, indentation, import order.
- Do not reformat unrelated lines. A diff should contain only the requested change.
- Make the smallest edit that solves the problem, then re-read the changed region.
- After edits, run the typecheck/build/test. A syntactically valid edit can still be wrong.

## Boundaries

- Stay inside the workspace. `..` outside it is rejected.
- Never touch `.git`, `node_modules` or generated output unless asked.
- Do not delete files to "clean up" unless the user asked or you created them this session.
- If a file is broken, say what is broken and fix that; do not add a parallel copy.
