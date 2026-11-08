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
    /** "max" = model's detected max context; number = cap at that exact value */
    num_ctx?: number | "max";
}

export interface RagSettings {
    /** Enable RAG features. Indexing/search still happen via the rag tool. */
    enabled?: boolean;
    /** Ollama embedding model (must be pulled locally), e.g. nomic-embed-text */
    embedModel?: string;
    /** Chunk size in characters */
    chunkSize?: number;
    /** Overlap between chunks in characters */
    chunkOverlap?: number;
    /** Default top-k results */
    topK?: number;
    /** SQLite path; relative paths resolve from workspace root */
    dbPath?: string;
}

export interface NoniConfig {
    /** In the global config, MCP servers live under `mcp.servers`. */
    mcp: { servers: Record<string, McpServerConfig> };
    /** Model defaults. */
    llm: LlmSettings;
    /** Local RAG / codebase retrieval settings. */
    rag: RagSettings;
}

/** Config location: $XDG_CONFIG_HOME/noni-chan/config.json, otherwise ~/.config/noni-chan/config.json */
export function configPath(): string {
    const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
    return join(base, "noni-chan", "config.json");
}

function defaultConfig(): NoniConfig {
    return {
        mcp: { servers: {} },
        llm: { num_ctx: "max" },
        rag: {
            enabled: true,
            embedModel: process.env.NONI_RAG_EMBED_MODEL ?? "nomic-embed-text",
            chunkSize: 1600,
            chunkOverlap: 200,
            topK: 6,
            dbPath: ".noni/rag.db",
        },
    };
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
                rag: { ...base.rag, ...(raw?.rag ?? {}) },
            },
            path,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { config: defaultConfig(), path, error: msg };
    }
}
