import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { Tui } from "./src/ui/Tui";
import { checkForUpdate, type UpdateInfo } from "./src/update/UpdateCheck";
import { createRuntime } from "./src/app/Runtime";
import { pickModel } from "./src/app/ModelPicker";
import { startServer, type RunningServer } from "./src/server/Server";
import { WebAgentUI } from "./src/server/WebAgentUI";

const cwd = process.cwd();
const updatePromise = checkForUpdate();
const ui = new Tui();

// Agent + tools ek hi jagah se: TUI aur `noni serve` dono yahi runtime use karte hain
const model = await pickModel(ui);
const runtime = await createRuntime({ cwd, model, ui });
const { agent, jobs, todos } = runtime;
if (runtime.configError) {
  ui.warn(`config.json padha nahi gaya (${runtime.configError}); defaults use kar rahi hoon`);
}

/** `/client on|off` — wahi process, wahi agent aur tools. */
const webUi = new WebAgentUI();
const CLIENT_PORT = Number(process.env.NONI_PORT) || 4317;
let client: RunningServer | null = null;
let clientStarting = false;

async function clientOn(port = CLIENT_PORT) {
  if (client) {
    ui.log(`client already ON → ${client.url}`);
    return;
  }
  if (clientStarting) {
    ui.log("client start ho raha hai…");
    return;
  }
  clientStarting = true;
  try {
    client = await startServer({ runtime, ui: webUi, port });
    ui.log(`client ON → ${client.url}`);
    if (process.env.NONI_SERVE_TOKEN) ui.log("token chahiye (x-noni-token)");
    ui.log("browser me kholo; band karne ke liye /client off");
  } catch (e: any) {
    ui.error(`client start nahi hua: ${e.message}`);
  } finally {
    clientStarting = false;
  }
}

async function clientOff() {
  if (!client) {
    ui.log("client already OFF");
    return;
  }
  const running = client;
  client = null;
  await running.stop();
  webUi.cancelPending();
  ui.log("client OFF");
}

function clientStatus(): string {
  return client ? `ON → ${client.url}` : "OFF";
}

let busy = false;
let closing = false;
let shuttingDown = false;

/** /img se attach hui image — agle message ke saath jati hai, phir clear */
let pendingImage: { path: string; base64: string; bytes: number } | null = null;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const fmtSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`);

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/** Image file → base64. Log me sirf path/size jata hai, data kabhi nahi */
async function loadImage(raw: string) {
  const clean = raw.trim().replace(/^~(?=$|\/)/, homedir());
  const abs = resolve(cwd, clean);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`image not found: ${clean}`);
  }
  if (!info.isFile()) throw new Error(`not a file: ${clean}`);
  const ext = extname(abs).toLowerCase();
  if (!IMAGE_MIME[ext]) throw new Error(`not an image (${ext || "no extension"}): ${clean}`);
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`image too big: ${(info.size / 1e6).toFixed(1)} MB (max 10 MB)`);
  if (!(await agent.supportsVision())) {
    throw new Error(`model ${agent.model} vision support nahi karta; /model se vision wala model chuno`);
  }
  return { path: clean, base64: (await readFile(abs)).toString("base64"), bytes: info.size };
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (client) {
    const running = client;
    client = null;
    await running.stop();
  }
  await runtime.shutdown();
}

ui.onExit(async () => {
  closing = true;
  // Stream ke beech Ctrl-D se process na mare, pehle current run poora hone do
  if (busy) return;
  await shutdown();
  process.exit(0);
});

ui.banner(agent.model, agent.listTools().length, todos.size);
if (runtime.planMode.on) {
  ui.log("plan mode ON (read-only) — agent plan dega, approve karne par tools khulenge. Band karne ke liye: /plan off");
}

/** Ek hi latest version ka warning dobara na dikhe */
let notifiedVersion = "";
function showUpdate(info: UpdateInfo, force = false) {
  if (!force && notifiedVersion === info.latest) return;
  notifiedVersion = info.latest;
  ui.warn(`update available: ${info.current} → ${info.latest}`);
  ui.log(`install: bun add -g ${info.name}@latest`);
}

const UPDATE_INTERVAL_MS =
  Number(process.env.NONI_UPDATE_INTERVAL_MS) || 6 * 60 * 60 * 1000;
let lastUpdateCheck = Date.now();

const update = await updatePromise;
if (update.status === "update") showUpdate(update);

while (true) {
  // Long session me bhi naya version pakdo: har 6 ghante (ya env override) pe check
  if (Date.now() - lastUpdateCheck >= UPDATE_INTERVAL_MS) {
    lastUpdateCheck = Date.now();
    const refreshed = await checkForUpdate();
    if (refreshed.status === "update") showUpdate(refreshed);
  }

  let input: string;
  try {
    input = await ui.prompt();
  } catch {
    break;
  }
  if (!input) continue;

  if (input === "/exit") ui.close();
  else if (input === "/clear") {
    if (runtime.runLock.busy) ui.warn("agent busy hai — jab chat khatam ho tab /clear karo");
    else {
      runtime.newSession();
      pendingImage = null;
      ui.log("chat clear — naya session shuru");
    }
  }
  else if (input === "/think") {
    agent.think = !agent.think;
    ui.log(`thinking: ${agent.think ? "ON" : "OFF"}`);
  } else if (input === "/plan" || input === "/plan on" || input === "/plan off") {
    const want = input === "/plan" ? !runtime.planMode.on : input === "/plan on";
    runtime.planMode.set(want);
    ui.log(
      want
        ? "plan mode ON — read-only investigation; agent exit_plan se approval maangega, phir tools khulenge"
        : "plan mode OFF — write/run tools enabled",
    );
  } else if (input === "/client" || input.startsWith("/client ")) {
    const parts = input.split(/\s+/);
    const arg = parts[1] ?? "";
    if (arg === "on") {
      const port = Number(parts[2]);
      await clientOn(Number.isFinite(port) && port > 0 ? port : CLIENT_PORT);
    } else if (arg === "off") await clientOff();
    else
      ui.log(
        `client: ${clientStatus()}\nusage: /client on [port] | /client off`,
      );
  } else if (input === "/history" || input.startsWith("/history ")) {
    const arg = input.split(/\s+/)[1] ?? "";
    if (!arg) {
      const sessions = runtime.history.list(15);
      ui.log(
        sessions.length
          ? sessions
              .map(
                (s) =>
                  `${String(s.id).padStart(3)}  ${s.updatedAt.slice(0, 16).replace("T", " ")}  ${s.title}`,
              )
              .join("\n")
          : "koi history nahi",
      );
      ui.log(`current: #${runtime.sessionId}`);
    } else if (runtime.runLock.busy) {
      ui.warn("agent busy hai — history baad me load karo");
    } else {
      const id = Number(arg);
      if (!Number.isInteger(id)) {
        ui.warn("usage: /history [id]");
      } else {
        try {
          const messages = runtime.loadSession(id);
          ui.log(`loaded #${id} (${messages.length} messages)`);
          const tail = messages
            .slice(-6)
            .map((m) => `${m.role}: ${m.content.replace(/\s+/g, " ").slice(0, 120)}`);
          if (tail.length) ui.log(tail.join("\n"));
        } catch (e: any) {
          ui.error(e.message);
        }
      }
    }
  } else if (input === "/skills" || input.startsWith("/skills ")) {
    const arg = input.slice(7).trim();
    if (!arg) {
      const skills = runtime.skills.list();
      ui.log(
        skills.length
          ? `${skills.length} skills (.ai)\n${runtime.skills.renderList()}\n\n/skills <name> dekhne ke liye, /skills reload disk se dobara`
          : `koi skill nahi mili\n${runtime.skills.locations().join("\n")}`,
      );
    } else if (arg === "reload") {
      const skills = await runtime.skills.load();
      ui.log(`${skills.length} skills reload ho gayi`);
    } else {
      const skill = runtime.skills.get(arg);
      if (!skill) ui.warn(`skill "${arg}" nahi mili — /skills se list dekho`);
      else {
        const body = skill.body.length > 1600 ? `${skill.body.slice(0, 1600)}\n…` : skill.body;
        ui.log(`# ${skill.name} (${skill.source}: ${skill.path})\n\n${body}`);
      }
    }
  } else if (input === "/update") {
    ui.log("checking npm for updates...");
    const result = await checkForUpdate();
    if (result.status === "update") showUpdate(result, true);
    else if (result.status === "current") ui.log(`up to date: ${result.name} ${result.current}`);
    else if (result.reason === "disabled") ui.warn("update check disabled (NONI_NO_UPDATE_CHECK)");
    else ui.warn("update check failed (offline ya npm registry down?)");
  } else if (input === "/help")
    ui.log(
      [
        "/help            ye list",
        "/tools           tools + dangerous markers",
        "/todos           current plan",
        "/todos clear     plan hatao",
        "/jobs            background jobs",
        "/jobs kill <id>  job band karo",
        "/img <path>      image agle message ke saath bhejo",
        "/img clear       pending image hatao",
        "/model <name>    model switch",
        "/clear           chat history clear (naya session)",
        "/history [id]    saved sessions dekho / load karo",
        "/skills          .ai skills list / content / reload",
        "/plan [on|off]   read-only plan mode (exit_plan se approval)",
        "/think           thinking on/off",
        "/client on|off   web UI server on/off (same process)",
        "/update          npm pe naya version check karo",
        "/exit            quit",
      ].join("\n"),
    );
  else if (input === "/tools")
    agent
      .listTools()
      .forEach((t) => ui.log(`${t.dangerous ? "⚠" : "·"} ${t.name}`));
  else if (input === "/todos") ui.todoTree(todos.render());
  else if (input === "/todos clear") {
    todos.clear();
    ui.log("todos cleared");
  } else if (input === "/jobs") {
    ui.log(jobs.render());
  } else if (input.startsWith("/jobs kill ")) {
    const id = input.split(/\s+/)[2] ?? "";
    if (!id) {
      ui.warn("usage: /jobs kill <id>");
    } else {
      try {
        const job = jobs.kill(id);
        ui.log(`job ${job.id}: ${job.status}`);
      } catch (e: any) {
        ui.error(e.message);
      }
    }
  } else if (input === "/img") {
    ui.log(
      pendingImage
        ? `image ready: ${pendingImage.path} (${fmtSize(pendingImage.bytes)}) — ab sawaal likho`
        : "usage: /img <path>   (agli message ke saath jayegi)",
    );
  } else if (input.startsWith("/img ")) {
    const arg = input.slice(4).trim();
    if (arg === "clear") {
      pendingImage = null;
      ui.log("image hata di");
    } else {
      try {
        pendingImage = await loadImage(arg);
        ui.log(`image ready: ${pendingImage.path} (${fmtSize(pendingImage.bytes)}) — ab sawaal likho`);
      } catch (e: any) {
        ui.error(e.message);
      }
    }
  } else if (input.startsWith("/model")) {
    if (runtime.runLock.busy) {
      ui.warn("agent busy hai — model baad me switch karo");
      continue;
    }
    agent.model = input.split(" ")[1] ?? agent.model;
    ui.log(`model: ${agent.model}`);
  } else {
    if (!runtime.runLock.tryAcquire()) {
      ui.warn("web client chat chal raha hai — /client off karo ya thoda wait karo");
      continue;
    }
    busy = true;
    const images = pendingImage ? [pendingImage.base64] : [];
    if (pendingImage) {
      ui.log(`+ image: ${pendingImage.path}`);
      pendingImage = null;
    }
    try {
      await agent.run(input, images);
    } catch (e: any) {
      ui.error(e.message);
    } finally {
      busy = false;
      runtime.runLock.release();
    }
  }
  if (closing) break;
}

await shutdown();
process.exit(0);
