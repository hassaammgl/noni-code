---
name: docs
description: Using read_docs and the DocsGuard before writing third-party library code.
---

# Documentation

Before writing code that uses a library, framework or API (not the language itself),
call `read_docs` and follow what it says instead of relying on memory.

```json
{"name":"zod","language":"js","topic":"object schema"}
```

- `language`: `js`, `python`, `c` (C/C++), `go`, `java`, `rust`, `other`. Always pass it.
- `topic` focuses the result. Use the exact feature you need.
- Sources are tried in order: installed packages / local docs → pydoc, go doc, man pages,
  system headers → npm/PyPI registry → web.
- C/C++ files are exempt from the guard, but `read_docs` with `language:"c"` still reads
  man pages and `/usr/include`.

## DocsGuard

`DocsGuard` blocks edits that introduce a **new** third-party import in `.js/.ts/.py` files
until that package's docs were read in this session.

- If blocked, call `read_docs` for the package, then retry the edit.
- The block message names the package. Use that exact name.
- It allows at most 2 blocks per package, so do not loop; read the docs.
- `/clear` resets the read list.
- Relative imports, `node:`/`bun:` builtins and C/C++ files are never blocked.
