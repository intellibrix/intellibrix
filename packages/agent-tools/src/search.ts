import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

/** One hit from a search backend. */
export type SearchResult = {
  title: string
  url: string
  /** A short excerpt or description. */
  snippet: string
}

/**
 * A web-search backend (Brave, Tavily, SearXNG, ...). Implementations are thin; the package
 * ships no default so you pick one explicitly.
 */
export interface SearchProvider {
  id: string
  search(query: string, options: { limit: number; signal?: AbortSignal }): Promise<SearchResult[]>
}

type FetchLike = typeof fetch

export type SearchProviderOptions = {
  /** Replaces the global `fetch`, for tests or a proxy. */
  fetch?: FetchLike
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

async function json(res: Response, who: string): Promise<unknown> {
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`${who} search failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
  }
  return res.json()
}

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    : []

/** [Brave Search](https://brave.com/search/api/). Needs an API key. */
export function braveSearch(options: SearchProviderOptions & { apiKey: string }): SearchProvider {
  const doFetch = options.fetch ?? fetch
  return {
    id: 'brave',
    async search(query, { limit, signal }) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search')
      url.searchParams.set('q', query)
      url.searchParams.set('count', String(limit))
      const res = await doFetch(url, {
        headers: { accept: 'application/json', 'x-subscription-token': options.apiKey },
        signal,
      })
      const body = (await json(res, 'Brave')) as { web?: { results?: unknown } }
      return list(body.web?.results).map((r) => ({
        title: str(r.title),
        url: str(r.url),
        snippet: str(r.description),
      }))
    },
  }
}

/** [Tavily](https://tavily.com). Needs an API key. */
export function tavilySearch(options: SearchProviderOptions & { apiKey: string }): SearchProvider {
  const doFetch = options.fetch ?? fetch
  return {
    id: 'tavily',
    async search(query, { limit, signal }) {
      const res = await doFetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ query, max_results: limit }),
        signal,
      })
      const body = (await json(res, 'Tavily')) as { results?: unknown }
      return list(body.results).map((r) => ({
        title: str(r.title),
        url: str(r.url),
        snippet: str(r.content),
      }))
    },
  }
}

/** A self-hosted [SearXNG](https://docs.searxng.org) instance, which must have the `json` format enabled. */
export function searxngSearch(
  options: SearchProviderOptions & { baseUrl: string },
): SearchProvider {
  const doFetch = options.fetch ?? fetch
  return {
    id: 'searxng',
    async search(query, { limit, signal }) {
      const url = new URL(
        'search',
        options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`,
      )
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      const res = await doFetch(url, { headers: { accept: 'application/json' }, signal })
      const body = (await json(res, 'SearXNG')) as { results?: unknown }
      return list(body.results)
        .slice(0, limit)
        .map((r) => ({ title: str(r.title), url: str(r.url), snippet: str(r.content) }))
    },
  }
}

export type WebSearchToolOptions = {
  /** Require approval for each search. A query can carry data out, but the backend is one you chose. @default false */
  needsApproval?: boolean
  /** Most results a call may ask for. @default 10 */
  maxResults?: number
}

/**
 * A `web_search` tool over a swappable {@link SearchProvider}. Results are titles, URLs and
 * snippets from the open web, so they are tagged `untrusted`; pair it with `fetch_url` to read a
 * result in full.
 */
export function webSearchTool(
  provider: SearchProvider,
  options: WebSearchToolOptions = {},
): ToolDefinition {
  const cap = options.maxResults ?? 10
  return defineTool({
    name: 'web_search',
    description: `Search the web (${provider.id}) and return titles, URLs and snippets. Use fetch_url to read a result in full.`,
    input: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(cap).default(Math.min(5, cap)),
    }),
    needsApproval: options.needsApproval ?? false,
    resultTrust: 'untrusted',
    execute: async ({ query, limit }, ctx) => {
      const results = await provider.search(query, {
        limit: limit ?? Math.min(5, cap),
        signal: ctx.signal,
      })
      return { query, results: results.filter((r) => r.url).slice(0, cap) }
    },
  })
}
