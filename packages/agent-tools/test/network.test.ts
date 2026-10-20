import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Intelligence, type ToolDefinition, validateToolInput } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  agentTools,
  askUserTool,
  delegateTool,
  fetchUrlTool,
  htmlToText,
  isPrivateAddress,
} from '../src/index.js'

const run = async (tool: ToolDefinition, input: unknown) =>
  tool.execute(await validateToolInput(tool, input), { runId: 'test' })

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (type: string, body: string | Buffer, status = 200) => {
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    }
    switch (req.url) {
      case '/page':
        return send(
          'text/html; charset=utf-8',
          '<html><head><title>Hi &amp; bye</title><style>p{}</style></head><body><script>evil()</script><h1>Head</h1><p>One&nbsp;two &#33;</p><p>Three</p></body></html>',
        )
      case '/article':
        return send(
          'text/html',
          '<html><head><title>Story</title></head><body><nav><a href="/home">Home</a></nav><div class="ad">BUY</div><article><h1>Big news</h1><p>First <a href="/more">link</a>.</p></article><footer>copyright</footer></body></html>',
        )
      case '/robots.txt':
        return send('text/plain', 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n')
      case '/private/secret':
      case '/private/ok':
        return send('text/plain', 'hidden')
      case '/blocked':
        return send('text/html', '<title>Just a moment...</title>', 403)
      case '/json':
        return send('application/json', '{"a":1}')
      case '/big':
        return send('text/plain', 'x'.repeat(5000))
      case '/bin':
        return send('image/png', Buffer.from([1, 2, 3]))
      case '/redirect':
        res.writeHead(302, { location: '/json' })
        return res.end()
      case '/loop':
        res.writeHead(302, { location: '/loop' })
        return res.end()
      case '/to-other-host':
        res.writeHead(302, {
          location: `http://localhost:${(server.address() as AddressInfo).port}/json`,
        })
        return res.end()
      default:
        return send('text/plain', 'nope', 404)
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('isPrivateAddress', () => {
  it('flags every non-public range, including wrapped IPv4', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      'not-an-ip',
    ])
      expect(isPrivateAddress(a), a).toBe(true)
  })

  it('lets public addresses through', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(a), a).toBe(false)
  })
})

describe('fetch_url', () => {
  const local = (extra = {}) => fetchUrlTool({ allowPrivateNetwork: true, ...extra })

  it('explains an HTTP error status instead of returning a bare empty page', async () => {
    const r = (await run(local(), { url: `${base}/blocked` })) as { status: number; note?: string }
    expect(r.status).toBe(403)
    expect(r.note).toMatch(/HTTP 403.*different source/)
    expect(
      ((await run(local(), { url: `${base}/json` })) as { note?: string }).note,
    ).toBeUndefined()
  })

  it('refuses private, loopback and metadata addresses by default', async () => {
    const tool = fetchUrlTool()
    for (const url of [
      `${base}/page`,
      'http://localhost/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:7f00:1]/',
      'http://2130706433/', // decimal 127.0.0.1
      'http://0x7f.1/',
    ])
      await expect(run(tool, { url }), url).rejects.toThrow(/private|internal|resolves/i)
  })

  it('refuses other schemes and credentials', async () => {
    await expect(run(local(), { url: 'file:///etc/passwd' })).rejects.toThrow(/Only http/)
    await expect(run(local(), { url: 'ftp://x/y' })).rejects.toThrow(/Only http/)
    await expect(run(local(), { url: `http://user:pw@127.0.0.1:1/` })).rejects.toThrow(
      /credentials/,
    )
    await expect(run(local(), { url: 'nonsense' })).rejects.toThrow(/valid URL/)
  })

  it('returns pages as readable text, or raw on request, tagged untrusted', async () => {
    const tool = local()
    expect(tool.resultTrust).toBe('untrusted')
    const r = await run(tool, { url: `${base}/page`, format: 'text' })
    expect(r).toMatchObject({
      status: 200,
      contentType: 'text/html',
      title: 'Hi & bye',
      truncated: false,
    })
    expect(r.content).toBe('Head\nOne two !\nThree')
    expect(r.content).not.toContain('evil')
    const raw = await run(tool, { url: `${base}/page`, format: 'raw' })
    expect(raw.content).toContain('<script>')
    expect((await run(tool, { url: `${base}/json` })).content).toBe('{"a":1}')
  })

  it('returns the main article as Markdown by default, without navigation or ads', async () => {
    const r = await run(local(), { url: `${base}/article` })
    expect(r.title).toBe('Story')
    expect(r.content).toBe(`# Big news\n\nFirst [link](${base}/more).`)
    const page = await run(local(), { url: `${base}/page` })
    expect(page.content).toBe('# Head\n\nOne two !\n\nThree')
  })

  it('obeys robots.txt only when asked to', async () => {
    const polite = local({ respectRobotsTxt: true })
    await expect(run(polite, { url: `${base}/private/secret` })).rejects.toThrow(
      /robots\.txt disallows/,
    )
    expect((await run(polite, { url: `${base}/private/ok` })).content).toBe('hidden')
    expect((await run(polite, { url: `${base}/json` })).status).toBe(200)
    expect((await run(local(), { url: `${base}/private/secret` })).content).toBe('hidden')
  })

  it('truncates by characters and by bytes', async () => {
    const r = await run(local(), { url: `${base}/big`, maxChars: 100 })
    expect(r.content).toHaveLength(100)
    expect(r.truncated).toBe(true)
    const small = await run(local({ maxBytes: 1000 }), { url: `${base}/big`, maxChars: 200_000 })
    expect(small.content).toHaveLength(1000)
    expect(small.truncated).toBe(true)
  })

  it('rejects binary content and 404 pages still report status', async () => {
    await expect(run(local(), { url: `${base}/bin` })).rejects.toThrow(
      /Not a text response \(image\/png\)/,
    )
    expect(await run(local(), { url: `${base}/missing` })).toMatchObject({
      status: 404,
      content: 'nope',
    })
  })

  it('follows redirects, caps them, and re-checks allowHosts on each hop', async () => {
    expect(await run(local(), { url: `${base}/redirect` })).toMatchObject({
      url: `${base}/json`,
      content: '{"a":1}',
    })
    await expect(run(local(), { url: `${base}/loop` })).rejects.toThrow(/Too many redirects/)
    const pinned = local({ allowHosts: ['127.0.0.1'] })
    await expect(run(pinned, { url: `${base}/to-other-host` })).rejects.toThrow(
      /Host not allowed: localhost/,
    )
  })

  it('blocks a redirect from a public-looking host to an internal one', async () => {
    // The first hop is allowed (private network on), the second is a literal internal address.
    const strict = fetchUrlTool({ allowHosts: ['127.0.0.1', '169.254.169.254'] })
    await expect(run(strict, { url: 'http://169.254.169.254/' })).rejects.toThrow(
      /private|internal/i,
    )
  })

  it('honors allowHosts wildcards and sets approval accordingly', async () => {
    expect(fetchUrlTool().needsApproval).toBe(true)
    expect(fetchUrlTool({ allowHosts: ['docs.example.com'] }).needsApproval).toBe(false)
    expect(
      fetchUrlTool({ allowHosts: ['docs.example.com'], needsApproval: true }).needsApproval,
    ).toBe(true)
    const tool = fetchUrlTool({ allowHosts: ['*.example.com'] })
    await expect(run(tool, { url: 'https://example.com/' })).rejects.toThrow(/Host not allowed/)
    await expect(run(tool, { url: 'https://evil-example.com/' })).rejects.toThrow(
      /Host not allowed/,
    )
  })

  it('times out slow servers', async () => {
    const slow = createServer(() => {})
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r))
    try {
      const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/`
      await expect(run(local({ timeoutMs: 100 }), { url })).rejects.toThrow(/Timed out/)
    } finally {
      slow.closeAllConnections()
      await new Promise<void>((r) => slow.close(() => r()))
    }
  })
})

describe('htmlToText', () => {
  it('drops markup, comments and scripts, and decodes entities', () => {
    expect(
      htmlToText('<!-- c --><p>a &lt;b&gt; &#x41;&#66; &unknown;</p><br>x<noscript>n</noscript>'),
    ).toEqual({
      title: undefined,
      text: 'a <b> AB &unknown;\n\nx',
    })
  })
})

describe('ask_user', () => {
  it('passes the question to the host and returns its answer', async () => {
    const seen: unknown[] = []
    const tool = askUserTool({
      ask: async (q) => {
        seen.push(q)
        return 'blue'
      },
    })
    expect(await run(tool, { question: 'Color?', choices: ['red', 'blue'] })).toEqual({
      answer: 'blue',
    })
    expect(await run(tool, { question: 'Why?' })).toEqual({ answer: 'blue' })
    expect(seen).toEqual([{ question: 'Color?', choices: ['red', 'blue'] }, { question: 'Why?' }])
    expect(tool.needsApproval).toBeFalsy()
  })
})

describe('delegate', () => {
  const sub = (reply: string, log: string[] = []) => ({
    async ask(prompt: string) {
      log.push(prompt)
      return { text: reply, messages: [], steps: 2, usage: {} }
    },
  })

  it('hands the task to the named sub-agent and returns its answer, untrusted by default', async () => {
    const log: string[] = []
    const tool = delegateTool({
      agents: { researcher: { agent: sub('found it', log), description: 'looks things up' } },
    })
    expect(tool.resultTrust).toBe('untrusted')
    expect(tool.description).toContain('researcher: looks things up')
    expect(await run(tool, { agent: 'researcher', task: 'find x' })).toEqual({
      agent: 'researcher',
      answer: 'found it',
      steps: 2,
    })
    expect(log).toEqual(['find x'])
    await expect(run(tool, { agent: 'nobody', task: 'x' })).rejects.toThrow(/Invalid input/)
    expect(
      delegateTool({ agents: { a: { agent: sub(''), description: '' } }, trusted: true })
        .resultTrust,
    ).toBeUndefined()
    expect(() => delegateTool({ agents: {} })).toThrow(/at least one/)
  })

  it('works with a real Intelligence as the sub-agent, inside an agent loop', async () => {
    const worker = new Intelligence({
      provider: new MockProvider([{ text: 'sub result' }]),
      model: 'm',
    })
    const boss = new Intelligence({
      provider: new MockProvider([
        { toolCalls: [{ toolName: 'delegate', input: { agent: 'worker', task: 'do it' } }] },
        { text: 'all done' },
      ]),
      model: 'm',
      tools: [delegateTool({ agents: { worker: { agent: worker, description: 'does work' } } })],
    })
    const r = await boss.ask('go')
    expect(r.text).toBe('all done')
    expect(JSON.stringify(r.messages)).toContain('sub result')
  })
})

describe('agentTools extras', () => {
  it('adds fetch_url, ask_user and delegate only when configured', () => {
    const names = agentTools({
      root: '.',
      fetch: true,
      askUser: { ask: async () => '' },
      delegate: {
        agents: {
          a: {
            agent: { ask: async () => ({ text: '', messages: [], steps: 0, usage: {} }) },
            description: 'a',
          },
        },
      },
    }).map((t) => t.name)
    expect(names).toEqual([
      'apply_patch',
      'run_checks',
      'todo',
      'calculator',
      'datetime',
      'json_query',
      'fetch_url',
      'ask_user',
      'delegate',
    ])
  })
})
