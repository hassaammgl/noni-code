# Noni avatar client

A local VRM avatar + voice + chat client for Noni: chat through the **Noni agent** (tools, todos, files) or fall back to **Ollama**, speak with your microphone, and hear replies through **Transformers.js** — all in the browser. The 3D character idles/blinks/lip-syncs on its own; the old animation tester dashboard has been removed.

> **Noni agent mode:** if the Noni bridge is running on `http://127.0.0.1:4317`, the chat uses the full Noni agent — tools, todos, jobs, docs guard and confirm dialogs. Without it, the app falls back to direct Ollama chat with the built-in persona. See [Noni agent mode](#noni-agent-mode).

## Noni agent mode

1. Repo root me TUI chalao aur `/client on` karo — server usi process me start hota hai (default 4317). Ya alag process: `bun run serve` / `noni-chan serve --port 4317`.
2. `cd client && bun run build` (ya hot-reload ke liye `bun run dev`), phir `http://127.0.0.1:4317/` kholo.
3. Upar ke pill me **Noni agent** dikhega. Dangerous tool chalne se pehle browser me Allow/Deny modal aata hai; `ask_user` ka jawab bhi wahin dete ho.
4. **Plan** button read-only plan mode toggle karta hai. Agent plan de to **Approve & execute** modal aata hai; approve karne par hi edits chalte hain.
5. Band karna ho to TUI me `/client off`.

## History

- Har user/assistant message SQLite me save hota hai (TUI aur web same DB).
- Web me **History** button se saved chats kholo, **+ New** se naya session.
- DB path: `~/.local/share/noni-chan/history.db` (`NONI_HISTORY_DB` se override).
- TUI me `/history` list, `/history <id>` load, `/clear` naya session.

```bash
# client URL badalna ho
VITE_NONI_URL=http://127.0.0.1:5000 bun run dev
# token wala server
VITE_NONI_TOKEN=secret bun run dev
```

Agar server band ho jaye to app direct Ollama mode pe fallback karta hai (persona aur tools ke bina).

## Chat (Ollama)

Ollama is only used for text generation. It is not a TTS engine.

1. Install and start [Ollama](https://ollama.com/).
2. Pull any chat model you want, for example:

```bash
ollama pull llama3.1:8b
ollama pull qwen2.5:7b
```

The chat bar lists every model Ollama has installed (via the official [`ollama`](https://www.npmjs.com/package/ollama) npm package). Pick one before you send; the choice is saved in the browser. If Ollama is down, the app still answers with local fallback lines.

The browser talks to Ollama directly. If you open the app from another machine, allow that origin on the Ollama host with `OLLAMA_ORIGINS`.

Thinking/reasoning output is disabled (`think: false`), so only the reply is shown.

## Voice (Transformers.js)

Both voice features run locally in Web Workers with [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers). No Python, server, container, or API key.

**Text-to-speech**
- Model: `onnx-community/Supertonic-TTS-ONNX` (ONNX/WASM).
- Voices: `F1`–`F5` and `M1`–`M5` in the voice dropdown.
- The model downloads on first use (~260 MB) and is cached by the browser.
- Only the final assistant reply is spoken; markdown, code, and tool/JSON payloads are stripped first.
- Japanese and Hindi/Urdu replies use the browser's Web Speech voice, since Supertonic is English-only.
- If Transformers.js cannot load, playback falls back to the Web Speech API.

**Speech-to-text**
- Model: `onnx-community/whisper-small` via Transformers.js (quantized, ~300 MB, cached).
- Press the 🎙 button to toggle **listening mode**. Speak normally — recording stops automatically after ~1.2 seconds of silence, transcribes, and sends the message.
- Listening mode stays on: after she finishes replying it starts listening again for the next turn. Press 🎙 again to turn it off.
- Requires microphone permission. Grant it when the browser asks.

While she is speaking, press **Stop** or send another message. In-flight speech is cancelled so two clips never overlap. Refreshing the page also cancels playback.

## Avatar (VRM)

- `public/models/waifu.vrm` + `public/motions/` se character load hota hai.
- Idle breathing, blinking, lip-sync aur reactions automatic hain — koi Play All/animation dashboard nahi.
- Model load fail ho to stage pe error dikhta hai; chat/voice phir bhi kaam karte hain.

## Configure

Copy `.env.example` to `.env` if Ollama runs somewhere else:

```bash
cp .env.example .env
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama origin used by the browser |
| `VITE_NONI_URL` | `http://127.0.0.1:4317` | Noni bridge URL (agent mode) |
| `VITE_NONI_TOKEN` | — | token if `NONI_SERVE_TOKEN` is set |

## Start

**Noni server ke saath (recommended):** TUI me `/client on` (ya `bun run serve`), phir `bun run build` ek baar, aur `http://127.0.0.1:4317/` kholo — server `client/dist` khud serve karta hai.

**Hot-reload dev:**

```bash
bun install
bun run dev
```

Open the printed local URL and type (or speak) a message. The first voice reply waits for the TTS model download; later replies are much faster.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No models in the picker | Is Ollama running on `VITE_OLLAMA_URL`? `curl http://127.0.0.1:11434/api/tags` |
| First reply takes a long time | Voice model is downloading once (~260 MB); watch the top status pill |
| `Voice unavailable` | Check the browser console; text replies still work |
| Mic button does nothing | Allow microphone access in the browser |
| Mic transcript is empty | Speak for at least a second, closer to the mic |
| Chat broken | Check Ollama separately; voice cannot take down chat |

## Scripts

```bash
bun run dev      # Vite dev server
bun run build    # production build
bun run preview  # preview the build
```

## Project layout

- `src/App.jsx` — chat UI, history drawer, mic control, confirm/ask modals.
- `src/lib/chat.js` — Ollama chat and model list.
- `src/lib/noni.js` — `noni serve` bridge (SSE chat, history, confirm/ask).
- `src/lib/waifu.js` — three.js/VRM renderer, idle life and speech.
- `src/lib/motion.js`, `fbxClip.js` — VRMA/FBX motion pipeline.
- `src/lib/lipSync.js` — mouth shapes and visemes.
- `src/lib/tts.js` — Transformers.js playback with Web Speech fallback.
- `src/lib/asrEngine.js`, `mic.js` — microphone capture and Whisper transcription.
- `src/workers/` — Transformers.js TTS/ASR workers.
- `public/` — VRM model and motion assets.
