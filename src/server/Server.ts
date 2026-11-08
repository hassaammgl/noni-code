import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { AddressInfo, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import type { Runtime } from "../app/Runtime";
import type { WebAgentUI } from "./WebAgentUI";

const MAX_BODY = 16 * 1024 * 1024; // base64 images ke liye
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const CLIENT_DIST = fileURLToPath(new URL("../../client/dist/", import.meta.url));

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".vrm": "model/gltf-binary",
    ".vrma": "application/octet-stream",
    ".fbx": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

const MISSING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Noni — client build missing</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06060b;color:#e8e6f3;
       font:14px/1.6 ui-sans-serif,system-ui,sans-serif}
  main{max-width:560px;padding:32px;border:1px solid #ffffff1a;border-radius:24px;background:#0d0d18}
  h1{margin:0 0 6px;font-size:20px}p{color:#a19fb4}
  code{background:#ffffff12;border-radius:6px;padding:2px 6px;color:#d7d3f5}
  pre{background:#00000055;border-radius:12px;padding:12px 14px;overflow:auto;color:#cfcbe8}
  a{color:#c4b5fd}
</style></head>
<body><main>
  <h1>Noni API is running</h1>
  <p>Browser UI build not found (<code>client/dist</code>). Choose one option:</p>
  <pre>cd client
bun install
bun run build</pre>
  <p>then reload this page. Or run with hot reload:</p>
  <pre>cd client
bun run dev</pre>
  <p>aur <a href="http://localhost:5173">http://localhost:5173</a> kholo.</p>
  <p>API health: <a href="/api/health">/api/health</a></p>
</main></body></html>`;

function message(e: unknown) {
    return e instanceof Error ? e.message : String(e);
}

function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    const extra = process.env.NONI_SERVE_ORIGIN;
    if (typeof origin === "string" && (LOCAL_ORIGIN.test(origin) || origin === extra)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-noni-token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res: ServerResponse, status: number, data: unknown) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(body);
}

function readBody(req: IncomingMessage): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error("request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                const raw = Buffer.concat(chunks).toString("utf8");
                resolve(raw ? (JSON.parse(raw) as Record<string, any>) : {});
            } catch {
                reject(new Error("invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

function tokenOk(req: IncomingMessage, url: URL): boolean {
    const expected = process.env.NONI_SERVE_TOKEN;
    if (!expected) return true;
    const header = req.headers["x-noni-token"];
    return header === expected || url.searchParams.get("token") === expected;
}

function clientFile(pathname: string): string | null {
    const rel =
        pathname === "/"
            ? "index.html"
            : decodeURIComponent(pathname).replace(/^\/+/, "");
    if (rel.includes("\0") || rel.split("/").includes("..")) return null;
    const root = resolve(CLIENT_DIST);
    const file = resolve(root, rel);
    return file === root || file.startsWith(`${root}/`) ? file : null;
}

async function sendFile(file: string, res: ServerResponse): Promise<boolean> {
    try {
        const info = await stat(file);
        if (!info.isFile()) return false;
        const body = await readFile(file);
        res.writeHead(200, {
            "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
            "Cache-Control": "no-cache",
        });
        res.end(body);
        return true;
    } catch {
        return false;
    }
}

/** Serve the UI from `client/dist`; show a setup page if the build is missing. */
async function serveClient(pathname: string, res: ServerResponse): Promise<void> {
    const file = clientFile(pathname);
    if (file && (await sendFile(file, res))) return;

    const index = join(CLIENT_DIST, "index.html");
    const hasBuild = await stat(index)
        .then((info) => info.isFile())
        .catch(() => false);

    if (!hasBuild) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(MISSING_PAGE);
        return;
    }

    // do not serve index.html for missing assets (js/css/wasm/vrm)
    if (file && extname(file)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
    }

    await sendFile(index, res);
}

export interface ServerOptions {
    runtime: Runtime;
    ui: WebAgentUI;
    port: number;
    host?: string;
}

export interface RunningServer {
    port: number;
    url: string;
    stop(): Promise<void>;
}

/** Local HTTP + SSE bridge used by the browser client to drive the agent. */
export function startServer({
    runtime,
    ui,
    port,
    host = "127.0.0.1",
}: ServerOptions): Promise<RunningServer> {
    const sockets = new Set<Socket>();

    const server = createServer(async (req, res) => {
        cors(req, res);
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (!tokenOk(req, url)) {
            json(res, 401, { error: "invalid token" });
            return;
        }

        try {
            if (req.method === "GET" && url.pathname === "/api/health") {
                json(res, 200, {
                    ok: true,
                    model: runtime.agent.model,
                    cwd: runtime.cwd,
                    sessionId: runtime.sessionId,
                    tools: runtime.agent.listTools().length,
                    skills: runtime.skills.list().length,
                    planMode: runtime.planMode.on,
                });
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/history") {
                json(res, 200, {
                    sessionId: runtime.sessionId,
                    sessions: runtime.history.list(30),
                });
                return;
            }

            const historyMatch = /^\/api\/history\/(\d+)$/.exec(url.pathname);
            if (historyMatch && req.method === "GET") {
                const id = Number(historyMatch[1]);
                const session = runtime.history.get(id);
                if (!session) {
                    json(res, 404, { error: "session not found" });
                    return;
                }
                json(res, 200, { session, messages: runtime.history.messages(id) });
                return;
            }

            const loadMatch = /^\/api\/history\/(\d+)\/load$/.exec(url.pathname);
            if (loadMatch && req.method === "POST") {
                if (runtime.runLock.busy) {
                    json(res, 409, { error: "agent busy" });
                    return;
                }
                const id = Number(loadMatch[1]);
                try {
                    const messages = runtime.loadSession(id);
                    json(res, 200, { session: runtime.history.get(id), messages });
                } catch (e) {
                    json(res, 404, { error: message(e) });
                }
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/history") {
                if (runtime.runLock.busy) {
                    json(res, 409, { error: "agent busy" });
                    return;
                }
                const id = runtime.newSession();
                json(res, 200, { session: runtime.history.get(id) });
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/state") {
                json(res, 200, {
                    model: runtime.agent.model,
                    think: runtime.agent.think,
                    planMode: runtime.planMode.on,
                    tools: runtime.agent.listTools().map((t) => ({
                        name: t.name,
                        dangerous: t.dangerous,
                    })),
                    todos: runtime.todos.render(),
                    jobs: runtime.jobs.render(),
                });
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/models") {
                const { models } = await runtime.ollama.list();
                json(res, 200, {
                    models: [...new Set(models.map((m) => m.name).filter(Boolean))],
                });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/model") {
                const body = await readBody(req);
                const model = String(body.model ?? "").trim();
                if (!model) {
                    json(res, 400, { error: "model is required" });
                    return;
                }
                if (runtime.runLock.busy) {
                    json(res, 409, { error: "agent busy" });
                    return;
                }
                runtime.agent.model = model;
                json(res, 200, { model });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/think") {
                const body = await readBody(req);
                runtime.agent.think = !!body.on;
                json(res, 200, { think: runtime.agent.think });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/plan") {
                if (runtime.runLock.busy) {
                    json(res, 409, { error: "agent busy" });
                    return;
                }
                const body = await readBody(req);
                runtime.planMode.set(!!body.on);
                json(res, 200, { planMode: runtime.planMode.on });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/clear") {
                if (runtime.runLock.busy) {
                    json(res, 409, { error: "agent busy" });
                    return;
                }
                const id = runtime.newSession();
                json(res, 200, { ok: true, sessionId: id });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/confirm") {
                const body = await readBody(req);
                const found = ui.resolve(String(body.id ?? ""), !!body.allow);
                json(res, found ? 200 : 404, { ok: found });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/answer") {
                const body = await readBody(req);
                const found = ui.resolve(String(body.id ?? ""), String(body.answer ?? ""));
                json(res, found ? 200 : 404, { ok: found });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/chat") {
                const body = await readBody(req);
                const messageText = String(body.message ?? "").trim();
                if (!messageText) {
                    json(res, 400, { error: "message is required" });
                    return;
                }
                if (!runtime.runLock.tryAcquire()) {
                    json(res, 409, { error: "agent busy" });
                    return;
                }

                const images = Array.isArray(body.images)
                    ? body.images.filter((v: unknown) => typeof v === "string")
                    : [];
                const model = typeof body.model === "string" ? body.model.trim() : "";
                if (model) runtime.agent.model = model;

                res.writeHead(200, {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "X-Accel-Buffering": "no",
                });

                const send = (event: string, data: Record<string, unknown> = {}) => {
                    if (res.writableEnded || res.destroyed) return;
                    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                };

                res.on("error", () => {
                    // client disconnect: stream band, agent ko chalne do
                });
                ui.attach(send);
                res.on("close", () => ui.cancelPending());

                const previousUI = runtime.ui;
                runtime.agent.setUI(ui);
                send("start", { model: runtime.agent.model });

                try {
                    await runtime.agent.run(messageText, images);
                    send("done", { text: ui.lastContent });
                } catch (e) {
                    send("error", { message: message(e) });
                } finally {
                    runtime.agent.setUI(previousUI);
                    runtime.runLock.release();
                    ui.detach();
                    res.end();
                }
                return;
            }

            if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
                await serveClient(url.pathname, res);
                return;
            }

            json(res, 404, { error: "not found" });
        } catch (e) {
            if (!res.headersSent) json(res, 500, { error: message(e) });
            else res.end();
        }
    });

    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
    });

    async function stop() {
        ui.cancelPending();
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    return new Promise<RunningServer>((resolve, reject) => {
        const onError = (e: Error) => reject(e);
        server.once("error", onError);
        server.listen(port, host, () => {
            server.off("error", onError);
            const actual = (server.address() as AddressInfo).port;
            resolve({ port: actual, url: `http://${host}:${actual}`, stop });
        });
    });
}
