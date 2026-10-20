import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'
import { htmlToMarkdown, pageTitle } from './html.js'
import { parseRobots, type Robots, robotsAllows } from './robots.js'

const MAX_REDIRECTS = 5

const BLOCKED = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3], // multicast, reserved and broadcast
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6')

/** The IPv4 address embedded in an IPv4-mapped, NAT64 or 6to4 IPv6 address, if there is one. */
function embeddedIPv4(address: string): string | undefined {
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (dotted) return dotted[1]
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/i.exec(address)
  const m = hex ?? sixToFour
  if (!m) return undefined
  const hi = Number.parseInt(m[1] as string, 16)
  const lo = Number.parseInt(m[2] as string, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/**
 * Whether `address` is loopback, private, link-local, multicast or otherwise not a public
 * internet address, including IPv6 forms that wrap an IPv4 address. Anything that is not an IP
 * literal counts as private so a caller can never fail open.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  if (family === 4) return BLOCKED.check(address, 'ipv4')
  const inner = embeddedIPv4(address)
  if (inner) return isPrivateAddress(inner)
  return BLOCKED.check(address, 'ipv6')
}

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchBlockedError'
  }
}

export type FetchUrlToolOptions = {
  /**
   * Only these hosts may be fetched: exact names (`docs.example.com`) or `*.example.com` for any
   * subdomain. Applies to redirects too.
   */
  allowHosts?: string[]
  /** Allow loopback, private and link-local addresses. Leave off unless you are testing locally. @default false */
  allowPrivateNetwork?: boolean
  /** Require approval for each fetch. Defaults to `true`, or `false` when `allowHosts` is set. */
  needsApproval?: boolean
  /** Largest body to read, in bytes. @default 1048576 */
  maxBytes?: number
  /** Overall time limit per fetch, in ms. @default 15000 */
  timeoutMs?: number
  /** Sent as `User-Agent`. @default 'intellibrix-agent-tools' */
  userAgent?: string
  /** Obey each site's `robots.txt`: refuse paths it disallows for `userAgent`. @default false */
  respectRobotsTxt?: boolean
}

function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase()
  return allow.some((rule) => {
    const r = rule.toLowerCase()
    return r.startsWith('*.') ? h.endsWith(r.slice(1)) && h.length > r.length - 1 : h === r
  })
}

type Fetched = {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
  truncated: boolean
}

/** One request to `url`, with the connection pinned to an address that passed the check. */
function request(
  url: URL,
  options: Required<Pick<FetchUrlToolOptions, 'maxBytes' | 'timeoutMs'>> & {
    allowPrivateNetwork: boolean
    userAgent: string
    signal?: AbortSignal
  },
): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5',
          // No compression: a small response must not inflate past maxBytes in memory.
          'accept-encoding': 'identity',
        },
        signal: options.signal,
        timeout: options.timeoutMs,
        // Resolving and checking here, at connect time, defeats DNS rebinding: the address that is
        // validated is the address that is connected to.
        lookup: (hostname, lookupOptions, callback) => {
          dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
            const list = addresses as { address: string; family: number }[] | undefined
            if (error || !list || list.length === 0) {
              ;(callback as (e: Error | null) => void)(
                error ?? new Error(`Cannot resolve ${hostname}`),
              )
              return
            }
            if (!options.allowPrivateNetwork) {
              const bad = list.find((a) => isPrivateAddress(a.address))
              if (bad) {
                ;(callback as (e: Error | null) => void)(
                  new FetchBlockedError(
                    `${hostname} resolves to a private or internal address (${bad.address})`,
                  ),
                )
                return
              }
            }
            if (lookupOptions.all) {
              ;(callback as (e: null, a: typeof list) => void)(null, list)
            } else {
              const [first] = list as [{ address: string; family: number }]
              ;(callback as (e: null, a: string, f: number) => void)(
                null,
                first.address,
                first.family,
              )
            }
          })
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        res.on('data', (chunk: Buffer) => {
          if (truncated) return
          size += chunk.length
          if (size > options.maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)))
            truncated = true
            res.destroy()
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
              truncated,
            })
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            truncated,
          }),
        )
        res.on('error', (error) => (truncated ? undefined : reject(error)))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${options.timeoutMs}ms`)))
    req.on('error', reject)
    req.end()
  })
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** A readable plain-text rendering of an HTML page: no scripts, styles or markup. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(
      /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|pre|blockquote)>|<br\s*\/?>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith('#')) {
        const code =
          name[1]?.toLowerCase() === 'x'
            ? Number.parseInt(name.slice(2), 16)
            : Number(name.slice(1))
        return Number.isInteger(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : whole
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title: title ? htmlToText(title).text || undefined : undefined, text }
}

type RequestOptions = Parameters<typeof request>[1]

const ROBOTS_TTL_MS = 10 * 60_000

/** Whether the site's robots.txt lets `userAgent` fetch `url`; fetched through the same guarded request. */
async function robotsPermits(
  url: URL,
  cache: Map<string, { robots: Robots | 'deny'; expires: number }>,
  options: RequestOptions,
): Promise<boolean> {
  let entry = cache.get(url.origin)
  if (!entry || entry.expires < Date.now()) {
    let robots: Robots | 'deny' = []
    try {
      const res = await request(new URL('/robots.txt', url), {
        ...options,
        maxBytes: Math.min(options.maxBytes, 512 * 1024),
      })
      // RFC 9309: a missing file allows everything, a server error disallows everything.
      if (res.status >= 500) robots = 'deny'
      else if (res.status < 300) robots = parseRobots(res.body.toString('utf8'))
    } catch (error) {
      if (error instanceof FetchBlockedError) throw error
    }
    entry = { robots, expires: Date.now() + ROBOTS_TTL_MS }
    cache.set(url.origin, entry)
  }
  if (entry.robots === 'deny') return false
  return robotsAllows(entry.robots, options.userAgent, url.pathname + url.search)
}

const TEXTUAL =
  /^(text\/|application\/(json|xml|xhtml\+xml|javascript|x-yaml|yaml|rss\+xml|atom\+xml)|.*[+/](json|xml)$)/i

/**
 * A `fetch_url` tool that reads a web page or API response as text, built so a prompt-injected
 * model cannot use it to reach your internal network:
 *
 * - only `http` and `https`;
 * - the address is checked when the connection is made, so DNS rebinding cannot swap in an internal
 *   one, and loopback, private, link-local (cloud metadata) and multicast ranges are refused;
 * - every redirect is followed by hand and re-checked, including against `allowHosts`;
 * - bounded in size and time, uncompressed, text content types only.
 *
 * Pages are returned as readable text (`format: 'raw'` for the source) and tagged `untrusted`.
 * Fetches need approval unless you pin `allowHosts`, because a URL can carry data out in its query
 * string.
 */
export function fetchUrlTool(options: FetchUrlToolOptions = {}): ToolDefinition {
  const maxBytes = options.maxBytes ?? 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 15_000
  const needsApproval = options.needsApproval ?? !options.allowHosts
  const userAgent = options.userAgent ?? 'intellibrix-agent-tools'
  const robotsCache = new Map<string, { robots: Robots | 'deny'; expires: number }>()
  return defineTool({
    name: 'fetch_url',
    description:
      'Fetch a public http(s) URL and return its content. Web pages come back as Markdown of the main article with links kept and navigation and ads removed (format "markdown"); "text" is plain text of the whole page and "raw" is the source. Cannot reach private or internal addresses.',
    input: z.object({
      url: z.string().min(1),
      format: z.enum(['markdown', 'text', 'raw']).default('markdown'),
      maxChars: z.number().int().min(100).max(200_000).default(20_000),
    }),
    needsApproval,
    resultTrust: 'untrusted',
    execute: async ({ url: input, format, maxChars }, ctx) => {
      let url: URL
      try {
        url = new URL(input)
      } catch {
        throw new Error(`Not a valid URL: ${input}`)
      }
      for (let hop = 0; ; hop++) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new FetchBlockedError(
            `Only http and https URLs can be fetched, not ${url.protocol}`,
          )
        }
        if (url.username || url.password)
          throw new FetchBlockedError('URLs with credentials are not allowed')
        if (options.allowHosts && !hostAllowed(url.hostname, options.allowHosts)) {
          throw new FetchBlockedError(`Host not allowed: ${url.hostname}`)
        }
        const literal = url.hostname.replace(/^\[|\]$/g, '')
        if (!options.allowPrivateNetwork && isIP(literal) && isPrivateAddress(literal)) {
          throw new FetchBlockedError(`Refusing to fetch a private or internal address: ${literal}`)
        }

        const requestOptions = {
          maxBytes,
          timeoutMs,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
          userAgent,
          signal: ctx.signal,
        }

        if (options.respectRobotsTxt) {
          const allowed = await robotsPermits(url, robotsCache, requestOptions)
          if (!allowed) {
            throw new FetchBlockedError(
              `${url.origin}/robots.txt disallows fetching ${url.pathname}. Use a different source.`,
            )
          }
        }

        const res = await request(url, requestOptions)

        const location = res.headers.location
        if (res.status >= 300 && res.status < 400 && location) {
          if (hop >= MAX_REDIRECTS)
            throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`)
          url = new URL(location, url)
          continue
        }

        const contentType = String(res.headers['content-type'] ?? '')
        if (contentType && !TEXTUAL.test(contentType)) {
          throw new Error(
            `Not a text response (${contentType.split(';')[0]}); only text content can be read`,
          )
        }
        const body = res.body.toString('utf8')
        const isHtml = /html/i.test(contentType) || /^\s*<(!doctype html|html)\b/i.test(body)
        const page =
          format === 'raw' || !isHtml
            ? { text: body }
            : format === 'text'
              ? htmlToText(body)
              : { title: pageTitle(body), text: htmlToMarkdown(body, { baseUrl: url.toString() }) }
        const content = page.text.slice(0, maxChars ?? 20_000)
        return {
          url: url.toString(),
          status: res.status,
          contentType: contentType.split(';')[0] || undefined,
          ...('title' in page && page.title ? { title: page.title } : {}),
          content,
          truncated: res.truncated || page.text.length > (maxChars ?? 20_000),
          ...(res.status >= 400
            ? {
                note: `The site answered HTTP ${res.status}, so this is not the page's content. Many sites refuse automated requests; do not retry it, use a different source.`,
              }
            : {}),
        }
      }
    },
  })
}
