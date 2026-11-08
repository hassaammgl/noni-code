import { readJson } from "../util/Fs";

export interface UpdateInfo {
  name: string;
  current: string;
  latest: string;
}

export type UpdateCheckResult =
  | ({ status: "update" } & UpdateInfo)
  | ({ status: "current" } & UpdateInfo)
  | { status: "unavailable"; reason: "disabled" | "offline" | "invalid" };

interface PackageJson {
  name?: string;
  version?: string;
}

const REGISTRY = "https://registry.npmjs.org";
const TIMEOUT_MS = 2_500;

function disabled(): boolean {
  const flag = process.env.NONI_NO_UPDATE_CHECK ?? process.env.NO_UPDATE_NOTIFIER;
  return !!flag && !/^(0|false|no)$/i.test(flag);
}

/** "3.0.4" / "v3.0.4" / "3.0.4-beta.1" -> [3, 0, 4] */
function core(version: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Is latest newer than current? A prerelease is treated as older than the same core version. */
export function isNewer(latest: string, current: string): boolean {
  const a = core(latest);
  const b = core(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  const latestPre = latest.includes("-");
  const currentPre = current.includes("-");
  return currentPre && !latestPre;
}

/**
 * Check npm registry for the latest version. Never throws:
 * returns "unavailable" on offline/registry failures. Does not write files/cache.
 */
export async function checkForUpdate(
  opts: { timeoutMs?: number; current?: string; name?: string } = {},
): Promise<UpdateCheckResult> {
  if (disabled()) return { status: "unavailable", reason: "disabled" };

  let pkg: PackageJson;
  try {
    pkg = await readJson<PackageJson>(
      new URL("../../package.json", import.meta.url),
    );
  } catch {
    return { status: "unavailable", reason: "invalid" };
  }

  const name = (opts.name ?? pkg.name)?.trim();
  const current = (opts.current ?? pkg.version)?.trim();
  if (!name || !current) return { status: "unavailable", reason: "invalid" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${REGISTRY}/${encodeURIComponent(name)}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { status: "unavailable", reason: "offline" };

    const data = (await res.json()) as { version?: unknown };
    const latest = typeof data.version === "string" ? data.version.trim() : "";
    if (!latest) return { status: "unavailable", reason: "offline" };

    return isNewer(latest, current)
      ? { status: "update", name, current, latest }
      : { status: "current", name, current, latest };
  } catch {
    // offline / DNS / timeout: chup rehna
    return { status: "unavailable", reason: "offline" };
  } finally {
    clearTimeout(timer);
  }
}
