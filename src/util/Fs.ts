import { existsSync } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** Whether a file or folder exists. */
export async function exists(path: string | URL): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export function readText(path: string | URL): Promise<string> {
    return readFile(path, "utf8");
}

export async function readJson<T = Record<string, any>>(path: string | URL): Promise<T> {
    return JSON.parse(await readText(path)) as T;
}

export function writeText(path: string | URL, data: string): Promise<void> {
    return writeFile(path, data, "utf8");
}

/** File size bytes me (file na mile to error) */
export async function sizeOf(path: string): Promise<number> {
    return (await stat(path)).size;
}

/** PATH me command ka poora path; na mile to null (setsid jaisi optional cheezein) */
export function which(cmd: string, envPath = process.env.PATH ?? ""): string | null {
    for (const dir of envPath.split(delimiter)) {
        if (!dir) continue;
        const full = join(dir, cmd);
        if (existsSync(full)) return full;
    }
    return null;
}
