import type { SearchEngine } from "../search/SearchEngine";
import { Tool } from "./Tool";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const TAIL_CHARS = 2_000;
const MAX_CHARS = 2_000_000;

/** Default readable output size. Keeps both head and tail; trims the middle. */
export const MAX_PAGE_CHARS = 8_000;
export const FETCH_TIMEOUT_MS = 15_000;

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    copy: "©",
    reg: "®",
    trade: "™",
    middot: "·",
    bull: "•",
};

/** HTML entities -> text. Numeric pehle, &amp; sabse aakhir me (double decode na ho). */
export function decodeEntities(s: string): string {
    const codePoint = (cp: number) => {
        // 0xD800-0xDFFF are surrogates and values above 0x10FFFF are invalid. Drop them so fetch does not fail.
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
        try {
            return String.fromCodePoint(cp);
        } catch {
            return "";
        }
    };
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
        .replace(/&([a-z][a-z0-9]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** For large output, keep the start and end (same pattern as BashTool). */
function truncate(s: string, maxChars = MAX_PAGE_CHARS): string {
    if (s.length <= maxChars) return s;
    const tail = Math.min(TAIL_CHARS, Math.floor(maxChars / 4));
    const head = maxChars - tail;
    const cut = s.length - head - tail;
    return `${s.slice(0, head)}\n...[${cut} chars truncated]...\n${s.slice(-tail)}`;
}

/**
 * HTML -> readable text. Without a parser library: remove script/style/head,
 * turn block tags into newlines, other tags into spaces, then decode entities and clean whitespace.
 */
export function htmlToText(html: string): string {
    const withoutHidden = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(head|script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");

    const withBreaks = withoutHidden
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<hr\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol|nav|main|aside|form|figure|figcaption|dd|dt|title)\s*>/gi, "\n")
        .replace(/<(img)\b[^>]*alt\s*=\s*"([^"]*)"[^>]*>/gi, " $2 ")
        .replace(/<[^>]+>/g, " ");

    return decodeEntities(withBreaks)
        .split("\n")
        .map((line) => line.replace(/[\s\f\v\u00a0]+/g, " ").trim())
        .filter((line) => line !== "")
        .join("\n");
}

function titleOf(html: string): string {
    const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
    return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

/** Read the body up to the cap, then close the stream (avoid loading large pages into memory). */
async function readCapped(res: Response, cap: number): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    try {
        while (out.length < cap) {
            const { done, value } = await reader.read();
            if (done) break;
            out += decoder.decode(value, { stream: true });
        }
        return out + decoder.decode();
    } finally {
        await reader.cancel().catch(() => {});
    }
}

/**
 * Fetches a URL and returns readable text. Used by both the web_fetch tool and docs sources,
 * so validation, content-type checks, and truncation live in one place.
 */
export async function fetchPageText(
    url: string,
    maxChars = MAX_PAGE_CHARS,
    timeoutMs = FETCH_TIMEOUT_MS,
): Promise<string> {
    const raw = String(url ?? "").trim();
    if (!raw) throw new Error("url is empty");

    let target: URL;
    try {
        target = new URL(raw);
    } catch {
        throw new Error(`invalid url: ${raw}`);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error("only http and https urls are supported");
    }

    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
        res = await fetch(target, {
            signal,
            redirect: "follow",
            headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
        });
    } catch {
        throw new Error(signal.aborted ? "timed out" : "not reachable");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const finalUrl = res.url || target.href;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const isHtml = type === "text/html" || type === "application/xhtml+xml";
    const isText = !type || type.startsWith("text/") || /(json|xml|javascript|x-www-form-urlencoded)$/.test(type);
    if (!isHtml && !isText) throw new Error(`unsupported content type: ${type}`);

    const body = await readCapped(res, MAX_CHARS);
    const looksHtml = isHtml || (!type && /^\s*</.test(body));

    if (!looksHtml) {
        return `URL: ${finalUrl}\n\n${truncate(body.trim(), maxChars) || "(no content)"}`;
    }

    const title = titleOf(body);
    const text = htmlToText(body);
    const head = [title ? `# ${title}` : "", `URL: ${finalUrl}`].filter(Boolean).join("\n");
    return `${head}\n\n${truncate(text, maxChars) || "(no readable text)"}`;
}

/** Fetches a URL and returns readable text. Useful for reading the best search result. */
export class WebFetchTool extends Tool {
    name = "web_fetch";
    description =
        "Fetch a URL (http/https) and return its readable text. Use after web_search to read the best result. " +
        "HTML is converted to plain text and long output is truncated.";
    parameters = {
        type: "object",
        properties: { url: { type: "string", description: "The page URL to fetch" } },
        required: ["url"],
    };

    constructor(private timeoutMs = FETCH_TIMEOUT_MS) {
        super();
    }

    async run({ url }: Record<string, any>) {
        return fetchPageText(String(url ?? ""), MAX_PAGE_CHARS, this.timeoutMs);
    }
}

/** SearchEngine performs the search (SearXNG -> DuckDuckGo fallback). This tool only formats results for the model. */
export class WebSearchTool extends Tool {
    name = "web_search";
    description =
        "Search the web. Returns top results with title, url and snippet. Use for current or unknown info, then web_fetch the best result to read it.";
    parameters = {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
    };

    constructor(private engine: SearchEngine) {
        super();
    }

    async run({ query }: Record<string, any>) {
        const { results, provider, cached } = await this.engine.search(String(query ?? ""));
        if (!results.length) return "no results";
        const list = results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 200)}` : ""}`)
            .join("\n");
        return `${list}\n(via ${provider}${cached ? ", cached" : ""})`;
    }
}
