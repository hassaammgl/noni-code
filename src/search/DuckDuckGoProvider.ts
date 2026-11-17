import { SearchProvider, type SearchResult } from "./SearchProvider";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

function decodeEntities(s: string): string {
    const codePoint = (cp: number) => {
        // 0xD800-0xDFFF are surrogates and values above 0x10FFFF are invalid. Drop them so search does not fail.
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
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

/**
 * DDG result links are redirects: //duckduckgo.com/l/?uddg=<encoded real url>&rut=...
 * Asli URL nikalo. duckduckgo.com ke apne links (ads: /y.js) bina uddg ke -> "" (drop).
 */
function unwrap(href: string): string {
    if (!href) return "";
    let u: URL;
    try {
        u = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
    } catch {
        return "";
    }
    if (u.hostname === "duckduckgo.com" || u.hostname.endsWith(".duckduckgo.com")) {
        return u.searchParams.get("uddg") ?? "";
    }
    return u.href;
}

/** HTML -> results. Exported separately so it can be tested without internet. */
export async function parseDuckDuckGo(html: string): Promise<SearchResult[]> {
    type Raw = { href: string; title: string; snippet: string; ad: boolean };
    const items: Raw[] = [];
    let cur: Raw | undefined;

    await new HTMLRewriter()
        .on("div.result, div.web-result", {
            element(el) {
                cur = { href: "", title: "", snippet: "", ad: /\bresult--ad\b/.test(el.getAttribute("class") ?? "") };
                items.push(cur);
            },
        })
        .on("a.result__a", {
            element(el) {
                if (cur && !cur.href) cur.href = el.getAttribute("href") ?? "";
            },
            text(t) {
                if (cur) cur.title += t.text;
            },
        })
        .on(".result__snippet", {
            text(t) {
                if (cur) cur.snippet += t.text;
            },
        })
        .transform(new Response(html))
        .text();

    const results: SearchResult[] = [];
    for (const it of items) {
        const url = it.ad ? "" : unwrap(it.href);
        const title = clean(it.title);
        if (!url || !title) continue;
        results.push({ title, url, snippet: clean(it.snippet) });
    }
    return results;
}

/** Keyless DuckDuckGo (HTML endpoint). Uses scraping, so keep it as a fallback. */
export class DuckDuckGoProvider extends SearchProvider {
    readonly name = "duckduckgo";

    constructor(private baseUrl = "https://html.duckduckgo.com") {
        super();
    }

    async search(query: string, limit: number, signal: AbortSignal): Promise<SearchResult[]> {
        let res: Response;
        try {
            res = await fetch(`${this.baseUrl}/html/?q=${encodeURIComponent(query)}`, {
                signal,
                headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
            });
        } catch {
            throw new Error(signal.aborted ? "timed out" : "not reachable");
        }
        // non-200 responses (e.g. 202) often indicate rate limiting or a bot check
        if (res.status !== 200) throw new Error(`HTTP ${res.status} (may be rate limited or blocked)`);

        const html = await res.text();
        const results = await parseDuckDuckGo(html);
        if (!results.length && /anomaly|captcha|unusual traffic/i.test(html)) {
            throw new Error("bot check/captcha detected; try again later");
        }
        return results.slice(0, limit * 2);
    }
}