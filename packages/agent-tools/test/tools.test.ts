import type { ToolDefinition } from 'intellibrix'
import { describe, expect, it } from 'vitest'
import { datetimeTool, htmlToMarkdown, parseRobots, robotsAllows } from '../src/index.js'

const run = (tool: ToolDefinition, input: unknown) =>
  tool.execute(input as never, { runId: 'r' } as never) as Promise<any>

describe('datetime', () => {
  const NOW = Date.UTC(2026, 2, 4, 15, 30, 0)
  const tool = datetimeTool({ now: () => NOW })

  it('tells the time in any zone, with the weekday', async () => {
    expect(await run(tool, { action: 'now' })).toMatchObject({
      iso: '2026-03-04T15:30:00Z',
      weekday: 'Wednesday',
      unix: NOW / 1000,
    })
    expect(await run(tool, { action: 'now', timeZone: 'Asia/Kolkata' })).toMatchObject({
      iso: '2026-03-04T21:00:00+05:30',
    })
  })

  it('converts, reading offset-less dates in the source zone', async () => {
    const r = await run(tool, {
      action: 'convert',
      date: '2026-07-01T09:00',
      timeZone: 'America/New_York',
      toTimeZone: 'Europe/Paris',
    })
    expect(r.from.iso).toBe('2026-07-01T09:00:00-04:00')
    expect(r.to.iso).toBe('2026-07-01T15:00:00+02:00')
    const explicit = await run(tool, {
      action: 'convert',
      date: '2026-01-01T00:00:00+09:00',
      toTimeZone: 'UTC',
    })
    expect(explicit.to.iso).toBe('2025-12-31T15:00:00Z')
  })

  it('adds calendar units on the wall clock and clamps month ends', async () => {
    expect((await run(tool, { action: 'add', date: '2026-01-31', months: 1 })).iso).toBe(
      '2026-02-28T00:00:00Z',
    )
    expect((await run(tool, { action: 'add', date: '2026-03-04', days: 90 })).iso).toBe(
      '2026-06-02T00:00:00Z',
    )
    expect((await run(tool, { action: 'add', years: -1, hours: 2 })).iso).toBe(
      '2025-03-04T17:30:00Z',
    )
    // +1 day across the US spring-forward keeps 12:00; +24h does not.
    const zone = 'America/New_York'
    const day = await run(tool, {
      action: 'add',
      date: '2026-03-07T12:00',
      days: 1,
      timeZone: zone,
    })
    const hours = await run(tool, {
      action: 'add',
      date: '2026-03-07T12:00',
      hours: 24,
      timeZone: zone,
    })
    expect(day.iso).toBe('2026-03-08T12:00:00-04:00')
    expect(hours.iso).toBe('2026-03-08T13:00:00-04:00')
  })

  it('measures the distance between two dates', async () => {
    const r = await run(tool, { action: 'diff', date: '2024-03-01', other: '2026-03-04T06:00' })
    expect(r.calendar).toEqual({ years: 2, months: 0, days: 3 })
    expect(r.clock).toEqual({ hours: 6, minutes: 0, seconds: 0 })
    expect(r.sign).toBe('later')
    const back = await run(tool, { action: 'diff', date: '2026-03-04', other: '2026-03-01' })
    expect(back).toMatchObject({ sign: 'earlier', totalDays: -3 })
  })

  it('refuses vague dates, impossible dates, unknown zones and missing arguments', async () => {
    await expect(run(tool, { action: 'convert', date: 'next tuesday' })).rejects.toThrow(/ISO 8601/)
    await expect(run(tool, { action: 'convert', date: '2026-02-30' })).rejects.toThrow(/real date/)
    await expect(run(tool, { action: 'now', timeZone: 'Mars/Base' })).rejects.toThrow(/time zone/)
    await expect(run(tool, { action: 'add', date: '2026-01-01' })).rejects.toThrow(/duration/)
    await expect(run(tool, { action: 'diff', date: '2026-01-01' })).rejects.toThrow(/other/)
  })
})

describe('htmlToMarkdown', () => {
  const md = (html: string, wholePage = false) =>
    htmlToMarkdown(html, { baseUrl: 'https://x.test/a/b', wholePage })

  it('keeps structure: headings, emphasis, lists, code, quotes and tables', () => {
    const out = md(`<body><main>
      <h2>Title</h2><p>Some <strong>bold</strong>, <em>soft</em> and <code>code()</code>.</p>
      <ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>
      <ol><li>first<li>second</ol>
      <pre><code class="language-ts">const a = 1;\n  if (a) {}</code></pre>
      <blockquote><p>quoted</p></blockquote>
      <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table>
      <hr><img src="p.png" alt="a chart"><img src="q.png">
    </main></body>`)
    expect(out).toBe(
      [
        '## Title',
        'Some **bold**, *soft* and `code()`.',
        '- one\n  - nested\n- two',
        '1. first\n2. second',
        '```ts\nconst a = 1;\n  if (a) {}\n```',
        '> quoted',
        '| A | B |\n| --- | --- |\n| 1 | x\\|y |',
        '---',
        '[image: a chart]',
      ].join('\n\n'),
    )
  })

  it('resolves links and drops unsafe or empty ones', () => {
    const out = md(
      '<p><a href="../c?q=1">rel</a> <a href="https://o.test/">https://o.test/</a> <a href="javascript:alert(1)">js</a> <a href="#top">top</a> <a href="/e"></a></p>',
    )
    expect(out).toBe('[rel](https://x.test/c?q=1) https://o.test/ js top')
  })

  it('drops page furniture but keeps a header inside the article', () => {
    const html = `<body><header>SITE</header><nav>menu</nav><div class="sidebar">side</div>
      <div id="cookie-banner">cookies</div><div style="display:none">hidden</div>
      <script>x()</script><style>.a{}</style><aside>aside</aside>
      <article><header><h1>Post</h1></header><p>${'Body text. '.repeat(30)}</p><footer>tags</footer></article>
      <footer>fine print</footer></body>`
    const out = md(html)
    expect(out).toContain('# Post')
    expect(out).toContain('Body text.')
    for (const gone of [
      'SITE',
      'menu',
      'side',
      'cookies',
      'hidden',
      'x()',
      'aside',
      'tags',
      'fine print',
    ])
      expect(out, gone).not.toContain(gone)
  })

  it('falls back to the whole body when the main element is a stub, or when asked', () => {
    const html =
      '<body><main><p>tiny</p></main><div><p>' +
      'The real content. '.repeat(40) +
      '</p></div></body>'
    expect(md(html)).toContain('The real content.')
    expect(md('<body><nav>menu</nav><article><p>short</p></article></body>', true)).toBe('short')
  })

  it('survives broken and hostile markup', () => {
    expect(() => md('<div><p>unclosed <b>bold <a href="x">link</div></a></b><<>>')).not.toThrow()
    expect(md('<p>a</p></div></div><p>b')).toBe('a\n\nb')
    expect(md('text &amp; &lt;b&gt; &#65;')).toBe('text & <b> A')
  })
})

describe('robots.txt', () => {
  const robots = parseRobots(`
    User-agent: *
    Disallow: /private
    Allow: /private/public
    Disallow: /*.json$
    Crawl-delay: 5

    User-agent: intellibrix-agent-tools
    User-agent: otherbot
    Disallow: /bot-only/
  `)
  const ua = 'intellibrix-agent-tools'

  it('prefers the most specific user-agent group', () => {
    expect(robotsAllows(robots, ua, '/bot-only/x')).toBe(false)
    // Our own group has no rule for /private, and groups are not merged.
    expect(robotsAllows(robots, ua, '/private/x')).toBe(true)
    expect(robotsAllows(robots, 'Mozilla/5.0', '/private/x')).toBe(false)
  })

  it('uses the longest matching rule, with wildcards and end anchors', () => {
    expect(robotsAllows(robots, 'curl/8', '/private/public/page')).toBe(true)
    expect(robotsAllows(robots, 'curl/8', '/data/a.json')).toBe(false)
    expect(robotsAllows(robots, 'curl/8', '/data/a.json?x=1')).toBe(true)
    expect(robotsAllows(robots, 'curl/8', '/open')).toBe(true)
  })

  it('treats an empty file or an empty Disallow as allow-all', () => {
    expect(robotsAllows(parseRobots(''), ua, '/anything')).toBe(true)
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:'), ua, '/anything')).toBe(true)
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), ua, '/anything')).toBe(false)
  })
})
