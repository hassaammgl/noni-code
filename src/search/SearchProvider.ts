export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * Every search backend (SearXNG, DuckDuckGo, Brave, etc.) extends this class.
 * A provider only does its own work: send a query and return results. Fallback/cache is handled by SearchEngine.
 * Throw an Error on failure (keep the message short and clear; it is shown to the user).
 */
export abstract class SearchProvider {
    abstract readonly name: string;
    abstract search(query: string, limit: number, signal: AbortSignal): Promise<SearchResult[]>;
}

