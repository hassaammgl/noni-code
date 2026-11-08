import { homedir } from "node:os";
import { join } from "node:path";
import { exists, readJson } from "../util/Fs";

/** Ek MCP server ki setting — pehle wale mcp.json jaisa hi shape */
export interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
}

export interface LlmSettings {
    /** "max" = model ki detected max context; number = us exact value pe cap */
    num_ctx?: number | "max";
}

export interface NoniConfig {
    /** In the global config, MCP servers live under `mcp.servers`. */
    mcp: { servers: Record<string, McpServerConfig> };
    /** Model defaults — currently only context length. */
    llm: LlmSettings;
}

/** Config location: $XDG_CONFIG_HOME/noni-chan/config.json, otherwise ~/.config/noni-chan/config.json */
export function configPath(): string {
    const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
    return join(base, "noni-chan", "config.json");
}

function defaultConfig(): NoniConfig {
    return { mcp: { servers: {} }, llm: { num_ctx: "max" } };
}

/** Read global config. Returns defaults with an error if the file is missing or JSON is invalid. */
export async function loadConfig(path = configPath()): Promise<{ config: NoniConfig; path: string; error?: string }> {
    if (!(await exists(path))) return { config: defaultConfig(), path };

    try {
        const raw = await readJson<Partial<NoniConfig> & Record<string, unknown>>(path);
        const base = defaultConfig();
        return {
            config: {
                ...base,
                ...raw,
                mcp: { servers: raw?.mcp?.servers ?? {} },
                llm: { ...base.llm, ...(raw?.llm ?? {}) },
            },
            path,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { config: defaultConfig(), path, error: msg };
    }
}
