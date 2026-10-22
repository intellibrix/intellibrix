import { type ToolDefinition, validateToolInput } from 'intellibrix'
import { describe, expect, it } from 'vitest'
import {
  agentTools,
  braveSearch,
  searxngSearch,
  tavilySearch,
  webSearchTool,
} from '../src/index.js'

const run = async (tool: ToolDefinition, input: unknown) =>
  tool.execute(await validateToolInput(tool, input), { runId: 'test' })

/** A fake `fetch` that records requests and answers with `body`. */
function fake(body: unknown, status = 200) {
  const seen: { url: string; init?: RequestInit }[] = []
  const impl = (async (url: URL | string, init?: RequestInit) => {
    seen.push({ url: String(url), init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { impl, seen }
}

const headers = (r?: { init?: RequestInit }) => (r?.init?.headers ?? {}) as Record<string, string>

describe('search providers', () => {
  it('brave: sends the key and maps results', async () => {
    const { impl, seen } = fake({
      web: { results: [{ title: 'T', url: 'https://a.test', description: 'D' }, 'junk'] },
    })
    const r = await braveSearch({ apiKey: 'k', fetch: impl }).search('hello world', { limit: 3 })
    expect(r).toEqual([{ title: 'T', url: 'https://a.test', snippet: 'D' }])
    const url = new URL(seen[0]?.url as string)
    expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search')
    expect(url.searchParams.get('q')).toBe('hello world')
    expect(url.searchParams.get('count')).toBe('3')
    expect(headers(seen[0])['x-subscription-token']).toBe('k')
  })

  it('tavily: posts JSON with a bearer key', async () => {
    const { impl, seen } = fake({ results: [{ title: 'T', url: 'https://b.test', content: 'C' }] })
    const r = await tavilySearch({ apiKey: 'k', fetch: impl }).search('q', { limit: 2 })
    expect(r).toEqual([{ title: 'T', url: 'https://b.test', snippet: 'C' }])
    expect(seen[0]?.url).toBe('https://api.tavily.com/search')
    expect(JSON.parse(seen[0]?.init?.body as string)).toEqual({ query: 'q', max_results: 2 })
    expect(headers(seen[0]).authorization).toBe('Bearer k')
  })

  it('searxng: honors the base URL and trims to the limit', async () => {
    const { impl, seen } = fake({
      results: [1, 2, 3].map((n) => ({
        title: `t${n}`,
        url: `https://c.test/${n}`,
        content: `c${n}`,
      })),
    })
    const r = await searxngSearch({ baseUrl: 'http://localhost:8080/sx', fetch: impl }).search(
      'q',
      { limit: 2 },
    )
    expect(r.map((x) => x.title)).toEqual(['t1', 't2'])
    const url = new URL(seen[0]?.url as string)
    expect(url.pathname).toBe('/sx/search')
    expect(url.searchParams.get('format')).toBe('json')
  })

  it('reports HTTP errors without leaking the key', async () => {
    const { impl } = fake('rate limited', 429)
    const p = braveSearch({ apiKey: 'secret-key', fetch: impl })
    const err = await p.search('q', { limit: 1 }).catch((e: Error) => e)
    expect((err as Error).message).toBe('Brave search failed: HTTP 429 rate limited')
    expect((err as Error).message).not.toContain('secret-key')
  })
})

describe('web_search', () => {
  const provider = {
    id: 'fake',
    async search(q: string, o: { limit: number }) {
      return Array.from({ length: o.limit }, (_, i) => ({
        title: `${q}${i}`,
        url: `https://x.test/${i}`,
        snippet: '',
      }))
    },
  }

  it('returns results untrusted, with a default and a capped limit', async () => {
    const tool = webSearchTool(provider, { maxResults: 4 })
    expect(tool.resultTrust).toBe('untrusted')
    expect(tool.needsApproval).toBe(false)
    expect((await run(tool, { query: 'a' })).results).toHaveLength(4)
    expect((await run(tool, { query: 'a', limit: 2 })).results).toHaveLength(2)
    await expect(run(tool, { query: 'a', limit: 5 })).rejects.toThrow(/Invalid input/)
    expect(webSearchTool(provider, { needsApproval: true }).needsApproval).toBe(true)
  })

  it('drops results with no URL, and plugs into agentTools', async () => {
    const odd = {
      id: 'odd',
      search: async () => [
        { title: 'x', url: '', snippet: '' },
        { title: 'y', url: 'https://y.test', snippet: '' },
      ],
    }
    expect((await run(webSearchTool(odd), { query: 'q' })).results).toHaveLength(1)
    expect(agentTools({ root: '.', search: { provider: odd } }).map((t) => t.name)).toContain(
      'web_search',
    )
  })
})
