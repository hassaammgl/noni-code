import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { arch, cpus, freemem, hostname, loadavg, release, totalmem, type, uptime } from "node:os";
import { Tool } from "./Tool";

const SECTIONS = ["all", "os", "cpu", "memory", "disk", "battery", "uptime"] as const;

function gb(bytes: number) {
    return (bytes / 1024 ** 3).toFixed(1);
}

function duration(seconds: number) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return [d ? `${d}d` : "", h ? `${h}h` : "", `${m}m`].filter(Boolean).join(" ");
}

async function sh(cmd: string) {
    return await new Promise<string>((resolve) => {
        execFile("bash", ["-lc", cmd], { timeout: 10_000, maxBuffer: 1_000_000 }, (_err, stdout) => {
            resolve(String(stdout ?? "").trim());
        });
    });
}

async function distro() {
    try {
        const text = await readFile("/etc/os-release", "utf8");
        return /^PRETTY_NAME="?(.+?)"?$/m.exec(text)?.[1] ?? "";
    } catch {
        return "";
    }
}

async function cpuModel() {
    try {
        const text = await readFile("/proc/cpuinfo", "utf8");
        return /^model name\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
    } catch {
        return cpus()[0]?.model ?? "";
    }
}

async function memory() {
    let available = freemem();
    try {
        const text = await readFile("/proc/meminfo", "utf8");
        const kb = Number(/^MemAvailable:\s*(\d+)/m.exec(text)?.[1]);
        if (kb) available = kb * 1024;
    } catch {}
    const total = totalmem();
    const used = total - available;
    const pct = Math.round((used / total) * 100);
    return `Memory (RAM): ${gb(used)} GiB used of ${gb(total)} GiB total (${pct}%)`;
}

async function battery() {
    try {
        const dirs = (await readdir("/sys/class/power_supply")).filter((d) => d.startsWith("BAT"));
        if (!dirs.length) return "no battery found";
        const rows: string[] = [];
        for (const d of dirs) {
            const base = `/sys/class/power_supply/${d}`;
            const [capacity, status] = await Promise.all([
                readFile(`${base}/capacity`, "utf8").catch(() => ""),
                readFile(`${base}/status`, "utf8").catch(() => ""),
            ]);
            rows.push(`${d}: ${capacity.trim() || "?"}% (${status.trim() || "unknown"})`);
        }
        return rows.join(", ");
    } catch {
        return "no battery found";
    }
}

async function disk() {
    const out = await sh("df -h --output=target,size,used,avail,pcent -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null || df -h");
    return out
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l, i) => i === 0 || !/^\/(sys|proc|dev|run|snap)\b/.test(l.split(" ")[0] ?? ""))
        .slice(0, 12)
        .join("\n");
}

export class SystemInfoTool extends Tool {
    name = "system_info";
    description =
        "Read the machine's system information: OS, CPU, memory, disk, battery and uptime. " +
        "Use this whenever the user asks about their computer, battery, RAM, CPU, disk space or how long it has been running. Never guess these numbers.";
    parameters = {
        type: "object",
        properties: {
            section: {
                type: "string",
                enum: [...SECTIONS],
                description: "Which part to read (default: all)",
            },
        },
    };

    async run({ section }: Record<string, any>) {
        const want = String(section ?? "all").toLowerCase();
        const pick = (name: (typeof SECTIONS)[number]) => want === "all" || want === name;

        const lines: string[] = [];

        if (pick("os")) {
            const d = await distro();
            const os = d || `${type()} ${release()}`;
            lines.push(`OS: ${os} (${type()} ${release()} ${arch()})`);
            lines.push(`Host: ${hostname()}`);
        }
        if (pick("cpu")) {
            const model = await cpuModel();
            lines.push(`CPU: ${model || "unknown"} (${cpus().length} threads)`);
        }
        if (pick("memory")) lines.push(await memory());
        if (pick("disk")) lines.push(`Disk:\n${await disk()}`);
        if (pick("battery")) lines.push(`Battery: ${await battery()}`);
        if (pick("uptime")) {
            lines.push(`Uptime: ${duration(uptime())}`);
            lines.push(`Load: ${loadavg().map((n) => n.toFixed(2)).join(" ")}`);
        }

        return lines.join("\n") || "(no info)";
    }
}
