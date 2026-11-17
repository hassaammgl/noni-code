import { Ollama } from "ollama";

export const FALLBACK_MODEL = "qwen3.5:0.8b";

/** Minimal UI required by the model picker (satisfied by Tui). */
export interface ModelPickerUI {
    warn(msg: string): void;
    chooseModel(
        models: { name: string; params: string; size: string }[],
        defaultIndex?: number,
    ): Promise<string>;
}

/** "752.39M" / "1.9B" -> billions, so the smallest model sorts first. */
export function paramsB(text: string): number {
    const m = /([\d.]+)\s*([KMBT])/i.exec(text);
    if (!m) return Number.POSITIVE_INFINITY;
    const n = Number(m[1]);
    const unit = m[2]!.toUpperCase();
    return n * (unit === "K" ? 1e-6 : unit === "M" ? 1e-3 : unit === "B" ? 1 : 1e3);
}

/** Fetch chat-capable models from Ollama, smallest first. */
export async function listChatModels(ollama: Ollama) {
    const { models } = await ollama.list();
    return models
        .filter((m) => {
            const caps = (m as { capabilities?: string[] }).capabilities;
            return !caps?.length || caps.includes("completion");
        })
        .map((m) => {
            const params = m.details?.parameter_size ?? "?";
            return {
                name: m.name,
                params,
                size: m.size ? `${(m.size / 1024 ** 3).toFixed(1)} GB` : "?",
                order: paramsB(params === "?" ? m.name : params),
                bytes: m.size,
            };
        })
        .sort((a, b) => a.order - b.order || a.bytes - b.bytes);
}

/** Select a model at startup. If OLLAMA_MODEL is set or stdin is not a TTY, use it/fallback without prompting. */
export async function pickModel(ui: ModelPickerUI): Promise<string> {
    const fromEnv = process.env.OLLAMA_MODEL?.trim();
    if (fromEnv) return fromEnv;
    if (!process.stdin.isTTY) return FALLBACK_MODEL;

    const ollama = new Ollama({
        host: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    });
    try {
        const choices = await listChatModels(ollama);
        if (!choices.length) {
            ui.warn(`no chat models found; using ${FALLBACK_MODEL}`);
            return FALLBACK_MODEL;
        }
        return await ui.chooseModel(choices, 0); // smallest = default
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ui.warn(`could not fetch model list from Ollama (${msg}); using ${FALLBACK_MODEL}`);
        return FALLBACK_MODEL;
    }
}

/** Server mode: env, otherwise the first chat model, otherwise fallback. */
export async function pickModelHeadless(): Promise<string> {
    const fromEnv = process.env.OLLAMA_MODEL?.trim();
    if (fromEnv) return fromEnv;
    const ollama = new Ollama({
        host: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    });
    try {
        const choices = await listChatModels(ollama);
        return choices[0]?.name ?? FALLBACK_MODEL;
    } catch {
        return FALLBACK_MODEL;
    }
}
