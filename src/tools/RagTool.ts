import type { RagStore } from "../rag/RagStore";
import { Tool } from "./Tool";

const ACTIONS = ["search", "index", "status", "clear"] as const;

export class RagTool extends Tool {
  name = "rag";
  description =
    "Local RAG over the workspace: semantic codebase retrieval using Ollama embeddings stored in SQLite. " +
    "Use action=search to find relevant files/chunks for a question (preferred for 'where is X implemented?', unfamiliar codebase navigation, or cross-file understanding). " +
    "Use action=index to build/refresh the index (incremental by file mtime/size). " +
    "Use action=status to see index stats. Use action=clear to delete the index. " +
    "Requires a local embedding model in Ollama (default: nomic-embed-text).";
  parameters = {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "search, index, status, or clear" },
      query: { type: "string", description: "Natural-language/code query for action=search" },
      path: { type: "string", description: "Workspace-relative path/folder to index for action=index (default: .)" },
      top_k: { type: "integer", description: "Number of chunks for action=search (default from config)" },
    },
    required: ["action"],
  };

  constructor(private rag: RagStore) {
    super();
  }

  override dangerousFor(args: Record<string, any>): boolean {
    return String(args.action ?? "") === "clear";
  }

  async run(args: Record<string, any>) {
    const action = String(args.action ?? "").trim().toLowerCase();

    if (action === "status") {
      const s = this.rag.status();
      return `RAG status\n- db: ${s.dbPath}\n- embedding model: ${s.embedModel}\n- indexed files: ${s.files}\n- chunks: ${s.chunks}\n\nTip: run rag {"action":"index"} if files/chunks are 0, then rag {"action":"search","query":"..."}.`;
    }

    if (action === "clear") {
      this.rag.clear();
      return "RAG index cleared.";
    }

    if (action === "index") {
      const path = typeof args.path === "string" ? args.path : ".";
      const r = await this.rag.indexPath(path);
      const lines = [
        `RAG index complete (${path})`,
        `- indexed: ${r.indexed}`,
        `- skipped: ${r.skipped}`,
        `- chunks: ${r.chunks}`,
        `- embedding model: ${this.rag.config.embedModel}`,
        `- db: ${this.rag.config.dbPath}`,
      ];
      if (r.errors.length) lines.push(`- errors:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`);
      if (r.indexed === 0 && r.chunks === 0 && r.errors.length) {
        lines.push("\nIf embeddings failed, pull the model in Ollama, e.g.: ollama pull nomic-embed-text");
      }
      return lines.join("\n");
    }

    if (action === "search") {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query is required for action=search");
      const topK = Number.isFinite(Number(args.top_k)) ? Math.floor(Number(args.top_k)) : undefined;
      const hits = await this.rag.search(query, topK);
      if (!hits.length) {
        const s = this.rag.status();
        return `No RAG results for: ${query}\nIndex has ${s.files} files / ${s.chunks} chunks. Run rag {"action":"index"} if needed.`;
      }
      const blocks = hits.map((h, i) => {
        const score = typeof h.score === "number" ? ` score=${h.score.toFixed(3)}` : "";
        const text = h.text.length > 1800 ? `${h.text.slice(0, 1800)}\n…[chunk truncated]` : h.text;
        return `### ${i + 1}. ${h.path}:${h.startLine}-${h.endLine}${score}\n${text}`;
      });
      return `RAG results (${hits.length}) for: ${query}\n\n${blocks.join("\n\n")}\n\nUse read_file/grep on the cited paths for exact context before editing.`;
    }

    throw new Error(`unknown action: ${action}. Use one of: ${ACTIONS.join(", ")}`);
  }
}
