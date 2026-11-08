import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { open, readdir, stat } from "node:fs/promises";
import type { Ollama } from "ollama";
import type { RagSettings } from "../config/Config";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".noni",
  "out",
]);
const MAX_FILE_BYTES = 500_000;
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cc",
  ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".sql",
  ".html", ".css", ".scss", ".sh", ".bash", ".zsh", ".env.example",
  ".graphql", ".proto", ".vue", ".svelte",
]);

export interface RagChunk {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score?: number;
}

function defaultSettings(cwd: string, rag: RagSettings = {}): Required<RagSettings> {
  const dbPath = rag.dbPath ?? ".noni/rag.db";
  return {
    enabled: rag.enabled ?? true,
    embedModel: rag.embedModel ?? process.env.NONI_RAG_EMBED_MODEL ?? "nomic-embed-text",
    chunkSize: Math.max(200, Math.floor(rag.chunkSize ?? 1600)),
    chunkOverlap: Math.max(0, Math.floor(rag.chunkOverlap ?? 200)),
    topK: Math.max(1, Math.floor(rag.topK ?? 6)),
    dbPath: isAbsolute(dbPath) ? dbPath : resolve(cwd, dbPath),
  };
}

function toBlob(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer);
}

function fromBlob(blob: Uint8Array): Float32Array {
  const buf = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(buf);
}

function cosine(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function extOf(path: string): string {
  const m = /\.[^.\/]+$/.exec(path);
  return m ? m[0].toLowerCase() : "";
}

function isProbablyText(path: string): boolean {
  const ext = extOf(path);
  if (!ext) return true; // extensionless files (Dockerfile, Makefile handled by name outside) — check bytes
  return TEXT_EXT.has(ext);
}

function chunkText(text: string, chunkSize: number, overlap: number): { startLine: number; endLine: number; text: string }[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chunks: { startLine: number; endLine: number; text: string }[] = [];
  let i = 0;
  while (i < lines.length) {
    let size = 0;
    let j = i;
    while (j < lines.length) {
      const add = lines[j]!.length + 1;
      if (j > i && size + add > chunkSize) break;
      size += add;
      j++;
      if (size >= chunkSize) break;
    }
    if (j <= i) j = Math.min(i + 1, lines.length);
    const body = lines.slice(i, j).join("\n").trim();
    if (body) chunks.push({ startLine: i + 1, endLine: j, text: body });
    if (j >= lines.length) break;
    const nextChar = Math.max(0, size - overlap);
    let k = i;
    let acc = 0;
    while (k < j - 1) {
      acc += lines[k]!.length + 1;
      if (acc >= nextChar) break;
      k++;
    }
    i = Math.max(k, i + 1);
  }
  return chunks;
}

export class RagStore {
  private db: Database;
  private settings: Required<RagSettings>;

  constructor(
    private cwd: string,
    private ollama: Ollama,
    settings: RagSettings = {},
  ) {
    this.settings = defaultSettings(cwd, settings);
    mkdirSync(dirname(this.settings.dbPath), { recursive: true });
    this.db = new Database(this.settings.dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        size INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path)");
  }

  get config() {
    return this.settings;
  }

  close() {
    this.db.close();
  }

  private resolvePath(input: string): string {
    const abs = resolve(this.cwd, input || ".");
    const rel = relative(this.cwd, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`outside workspace: ${input}`);
    return abs;
  }

  private async *walk(dir: string): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) yield* this.walk(full);
      else if (e.isFile()) yield full;
    }
  }

  private async readTextFile(path: string): Promise<string | null> {
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const base = path.split("/").pop() ?? "";
    const knownName = /^(Dockerfile|Makefile|README|LICENSE|AGENTS\.md)$/i.test(base);
    if (!isProbablyText(path) && !knownName) return null;
    const handle = await open(path, "r");
    try {
      const buf = Buffer.alloc(2048);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      if (buf.subarray(0, bytesRead).includes(0)) return null;
    } finally {
      await handle.close();
    }
    return await Bun.file(path).text();
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const res: any = await (this.ollama as any).embed({
      model: this.settings.embedModel,
      input: texts,
    });
    const embeddings = res?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(`embedding failed for model ${this.settings.embedModel}`);
    }
    return embeddings as number[][];
  }

  async indexPath(input = "."): Promise<{ indexed: number; skipped: number; chunks: number; errors: string[] }> {
    const target = this.resolvePath(input);
    const info = await this.statOrThrow(target, input);
    const files = info.isDirectory() ? this.walk(target) : (async function* () { yield target; })();
    let indexed = 0;
    let skipped = 0;
    let chunksTotal = 0;
    const errors: string[] = [];

    for await (const file of files) {
      const rel = relative(this.cwd, file);
      try {
        const st = await stat(file);
        const existing = this.db.query("SELECT mtime_ms, size FROM files WHERE path = ?").get(rel) as
          | { mtime_ms: number; size: number }
          | null;
        if (existing && existing.mtime_ms === Math.floor(st.mtimeMs) && existing.size === st.size) {
          skipped++;
          continue;
        }
        const text = await this.readTextFile(file);
        if (text == null) {
          skipped++;
          continue;
        }
        const parts = chunkText(text, this.settings.chunkSize, this.settings.chunkOverlap);
        this.db.run("DELETE FROM chunks WHERE path = ?", [rel]);
        this.db.run("DELETE FROM files WHERE path = ?", [rel]);
        if (!parts.length) {
          skipped++;
          continue;
        }
        const vectors = await this.embed(parts.map((p) => `${rel}\n${p.text}`));
        const now = new Date().toISOString();
        this.db.run("INSERT INTO files (path, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?)", [
          rel,
          Math.floor(st.mtimeMs),
          st.size,
          now,
        ]);
        const ins = this.db.prepare(
          "INSERT INTO chunks (path, start_line, end_line, text, embedding) VALUES (?, ?, ?, ?, ?)",
        );
        const runTx = this.db.transaction(() => {
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i]!;
            ins.run(rel, p.startLine, p.endLine, p.text, toBlob(vectors[i]!));
          }
        });
        runTx();
        indexed++;
        chunksTotal += parts.length;
      } catch (e: any) {
        errors.push(`${rel}: ${e?.message ?? String(e)}`);
        if (errors.length > 8) errors.push("…stopping after repeated errors");
        if (errors.length > 8) break;
      }
    }

    return { indexed, skipped, chunks: chunksTotal, errors };
  }

  private async statOrThrow(abs: string, original: string) {
    try {
      return await stat(abs);
    } catch {
      throw new Error(`not found: ${original}`);
    }
  }

  async search(query: string, topK = this.settings.topK): Promise<RagChunk[]> {
    const q = String(query ?? "").trim();
    if (!q) throw new Error("query is empty");
    const [qVecRaw] = await this.embed([q]);
    const qVec = new Float32Array(qVecRaw!);
    const rows = this.db
      .query("SELECT id, path, start_line AS startLine, end_line AS endLine, text, embedding FROM chunks")
      .all() as { id: number; path: string; startLine: number; endLine: number; text: string; embedding: Uint8Array }[];
    const scored = rows
      .map((r) => ({ ...r, score: cosine(qVec, fromBlob(r.embedding)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK))
      .filter((r) => r.score > 0.05);
    return scored.map(({ embedding: _e, ...r }) => r);
  }

  status(): { dbPath: string; embedModel: string; files: number; chunks: number } {
    const files = (this.db.query("SELECT COUNT(*) AS n FROM files").get() as { n: number }).n;
    const chunks = (this.db.query("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
    return { dbPath: this.settings.dbPath, embedModel: this.settings.embedModel, files, chunks };
  }

  clear() {
    this.db.run("DELETE FROM chunks");
    this.db.run("DELETE FROM files");
  }
}
