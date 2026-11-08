import { createRuntime } from "./src/app/Runtime";
import { pickModelHeadless } from "./src/app/ModelPicker";
import { startServer } from "./src/server/Server";
import { WebAgentUI } from "./src/server/WebAgentUI";

/** `--port 4317` or NONI_PORT, otherwise the default. */
function portFromArgs(): number {
    const i = process.argv.indexOf("--port");
    const raw = i > -1 ? process.argv[i + 1] : process.env.NONI_PORT;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4317;
}

const port = portFromArgs();
const model = await pickModelHeadless();

const ui = new WebAgentUI();
const runtime = await createRuntime({ cwd: process.cwd(), model, ui });
if (runtime.configError) {
    console.warn(`could not read config.json (${runtime.configError}); using defaults`);
}

const server = await startServer({ runtime, ui, port });
console.log(
    `noni serve → ${server.url}  ·  model: ${runtime.agent.model}  ·  ${runtime.agent.listTools().length} tools`,
);
if (!process.env.NONI_SERVE_TOKEN) {
    console.log("  local-only (127.0.0.1); set NONI_SERVE_TOKEN to require a token");
}

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    await runtime.shutdown();
    await server.stop();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
