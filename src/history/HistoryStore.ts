import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HistoryRole = "user" | "assistant" | "tool";

export interface HistoryMessage {
    role: HistoryRole;
    content: string;
    thinking?: string;
    createdAt: string;
}

export interface HistorySession {
    id: number;
    title: string;
    model: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
}

export interface NewMessage {
    role: HistoryRole;
    content: string;
    thinking?: string;
}

export function defaultHistoryPath(): string {
    if (process.env.NONI_HISTORY_DB) return process.env.NONI_HISTORY_DB;
    const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
    return join(base, "noni-chan", "history.db");
}

function now() {
    return new Date().toISOString();
}

function titleFor(content: string): string {
    const one = content.replace(/\s+/g, " ").trim();
    return one.length > 60 ? `${one.slice(0, 60)}…` : one || "New chat";
}

/** SQLite chat history: sessions + messages. Shared by the TUI and web. */
export class HistoryStore {
    private db: Database;

    constructor(path = defaultHistoryPath()) {
        if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path, { create: true });
        this.db.run("PRAGMA journal_mode = WAL");
        this.db.run("PRAGMA foreign_keys = ON");
        this.db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                cwd TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);
        this.db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                thinking TEXT,
                created_at TEXT NOT NULL
            )
        `);
        this.db.run("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)");
    }

    createSession({ model, cwd, title = "New chat" }: { model: string; cwd: string; title?: string }) {
        const time = now();
        const info = this.db
            .query(
                "INSERT INTO sessions (title, model, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(title, model, cwd, time, time);
        return Number(info.lastInsertRowid);
    }

    append(sessionId: number, msg: NewMessage): number {
        const time = now();
        const info = this.db
            .query(
                "INSERT INTO messages (session_id, role, content, thinking, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(sessionId, msg.role, msg.content, msg.thinking ?? null, time);
        this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(time, sessionId);

        // The first user message becomes the session title
        if (msg.role === "user" && msg.content.trim()) {
            this.db
                .query("UPDATE sessions SET title = ? WHERE id = ? AND title = 'New chat'")
                .run(titleFor(msg.content), sessionId);
        }
        return Number(info.lastInsertRowid);
    }

    list(limit = 30): HistorySession[] {
        const rows = this.db
            .query(
                `SELECT id, title, model, cwd, created_at AS createdAt, updated_at AS updatedAt
                 FROM sessions ORDER BY updated_at DESC LIMIT ?`,
            )
            .all(limit) as HistorySession[];
        return rows;
    }

    get(sessionId: number): HistorySession | null {
        return (this.db
            .query(
                `SELECT id, title, model, cwd, created_at AS createdAt, updated_at AS updatedAt
                 FROM sessions WHERE id = ?`,
            )
            .get(sessionId) as HistorySession | null) ?? null;
    }

    messages(sessionId: number, limit = 500): HistoryMessage[] {
        return this.db
            .query(
                `SELECT role, content, thinking, created_at AS createdAt FROM (
                    SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?
                 ) ORDER BY id ASC`,
            )
            .all(sessionId, limit) as HistoryMessage[];
    }

    delete(sessionId: number) {
        this.db.query("DELETE FROM sessions WHERE id = ?").run(sessionId);
    }

    close() {
        this.db.close();
    }
}
