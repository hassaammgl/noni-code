#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
// `noni-chan serve` web UI ke liye local server chalata hai
const isServe = args[0] === "serve";
const entry = join(root, isServe ? "serve.ts" : "index.ts");
const entryArgs = isServe ? args.slice(1) : args;

const child = spawn("bun", [entry, ...entryArgs], {
    stdio: "inherit",
    env: process.env,
});

child.on("error", (err) => {
    if (err.code === "ENOENT") {
        console.error("Noni needs Bun to run: https://bun.sh");
        console.error("Install: curl -fsSL https://bun.sh/install | bash");
    } else {
        console.error(`Failed to start Noni: ${err.message}`);
    }
    process.exit(1);
});

child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
});
