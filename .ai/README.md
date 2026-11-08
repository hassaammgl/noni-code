# `.ai` — Noni skills

Ye folder Noni ke **skills** rakhta hai: markdown instruction packs jo agent zarurat
par padhta hai. Persona (`src/agent/persona.md`) chhoti rehti hai kyunki tool/flow ki
detail yahan rehti hai.

## Kaise kaam karta hai

- App startup par `.ai/skills/**.md` scan hoti hain.
- System prompt me sirf **index** jata hai: `- name: one-line description`.
- Poora text tab load hota hai jab model `skill {"action":"read","name":"tools"}` call kare.
- Isi liye 50 skills bhi hon to prompt sirf ~50 lines bada hota hai.

## Skill likhna

```markdown
---
name: my-skill
description: One line that tells the model when to load this.
---

# Heading

Instructions…
```

- `name` na do to filename (`my-skill.md`) ya folder (`my-skill/SKILL.md`) se aa jata hai.
- `description` na do to body ki pehli non-heading line use hoti hai.
- Ek skill 24,000 characters tak load hoti hai (uske baad truncate).

## Kahan rakhein

| Location | Scope |
| --- | --- |
| `<project>/.ai/skills/` | sirf is project ke liye (highest priority) |
| `~/.config/noni-chan/.ai/skills/` | har project me |
| `<package>/.ai/skills/` | built-in defaults (Noni ke saath ship) |
| `NONI_SKILLS_DIR` | extra folder(s), `:` se separated |

Same naam ho to baad wali jeet ti hai (project > global > built-in).

## Commands

- TUI: `/skills` — list; `/skills <name>` — content; `/skills reload` — disk se dobara padho.
- Agent: `skill {"action":"list"}` aur `skill {"action":"read","name":"..."}`.
