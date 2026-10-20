import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryKeyValueStore, type ToolDefinition } from 'intellibrix'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyPatchTool,
  createUnifiedDiff,
  datetimeTool,
  diffTool,
  htmlToMarkdown,
  jsonQueryTool,
  memoryTool,
  parseRobots,
  queryJson,
  robotsAllows,
} from '../src/index.js'

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

describe('json_query', () => {
  const data = {
    name: 'shop',
    items: [
      { id: 1, name: 'pen', price: 2.5, tags: ['office', 'cheap'], type: 'a' },
      { id: 2, name: 'desk', price: 150, tags: ['office'], type: 'b' },
      { id: 3, name: 'lamp', price: 40, tags: [], type: 'b', note: null },
    ],
    meta: { page: 1, 'odd key': true },
  }
  const q = (query: string) => queryJson(data, query)

  it('walks paths, indexes, slices and iterates', () => {
    expect(q('.name')).toEqual(['shop'])
    expect(q('.items[1].name')).toEqual(['desk'])
    expect(q('.items[-1].id')).toEqual([3])
    expect(q('.items[0:2] | length')).toEqual([2])
    expect(q('.items[].id')).toEqual([1, 2, 3])
    expect(q('.meta."odd key"')).toEqual([true])
    expect(q('.missing.deeper')).toEqual([null])
    expect(q('.items[0].tags[]')).toEqual(['office', 'cheap'])
    expect(q('[..] | length > 10')).toEqual([true])
  })

  it('filters, maps, sorts and groups', () => {
    expect(q('.items[] | select(.price > 10) | .name')).toEqual(['desk', 'lamp'])
    expect(q('.items | map(.price) | add')).toEqual([192.5])
    expect(q('.items | sort_by(.price) | reverse | map(.id)')).toEqual([[2, 3, 1]])
    expect(q('.items | group_by(.type) | map({type: .[0].type, n: length})')).toEqual([
      [
        { type: 'a', n: 1 },
        { type: 'b', n: 2 },
      ],
    ])
    expect(q('.items | max_by(.price).name')).toEqual(['desk'])
    expect(q('[.items[].tags[]] | unique')).toEqual([['cheap', 'office']])
    expect(q('.items[] | select(.tags | contains(["cheap"])) | .id')).toEqual([1])
    expect(q('.items[] | select(.name | startswith("l")) | .id')).toEqual([3])
    expect(q('.items[] | select(.price < 10 or .id == 3) | .id')).toEqual([1, 3])
    expect(q('.items[] | select(.price > 1 and .type == "b") | .id')).toEqual([2, 3])
  })

  it('builds objects and arrays, does arithmetic, defaults and conditionals', () => {
    expect(q('.items[0] | {name, cost: (.price * 2)}')).toEqual([{ name: 'pen', cost: 5 }])
    expect(q('{a: 1} + {b: 2}')).toEqual([{ a: 1, b: 2 }])
    expect(q('.items[2].note // "none"')).toEqual(['none'])
    expect(
      q('.items[] | if .price > 100 then "big" elif .price > 10 then "mid" else "small" end'),
    ).toEqual(['small', 'big', 'mid'])
    expect(q('.meta | keys')).toEqual([['odd key', 'page']])
    expect(q('(.items | length), (.items | map(.id) | join("-"))')).toEqual([3, '1-2-3'])
    expect(q('[range(3)] | map(. * 2)')).toEqual([[0, 2, 4]])
    expect(q('10 % 4 - -1')).toEqual([3])
    expect(q('.items[] | .name | ascii_upcase | limit(1; .)')).toEqual(['PEN', 'DESK', 'LAMP'])
  })

  it('reports mistakes clearly and treats ? as try', () => {
    expect(() => q('.name | .x')).toThrow(/Cannot index string/)
    expect(q('.name | .x?')).toEqual([])
    expect(() => q('.items[')).toThrow(/Expected|Unexpected/)
    expect(() => q('nope(1)')).toThrow(/nope\/1 is not defined/)
    expect(() => q('1 / 0')).toThrow(/zero/)
    expect(() => q('.name + 1')).toThrow(/cannot be combined/)
    expect(() => q('$x')).toThrow(/Unexpected/)
  })

  it('cannot be turned against the host: bounded work and no access to anything', () => {
    expect(() => queryJson(data, '[range(5000)] | map(range(5000))')).toThrow(
      /too (many|long|large)/,
    )
    expect(() => queryJson(data, `${'('.repeat(500)}1${')'.repeat(500)}`)).toThrow(/deeply/)
    expect(() => queryJson(data, '__proto__')).toThrow(/not defined/)
    expect(queryJson({ constructor: 1 }, '.constructor')).toEqual([1])
    expect(queryJson({}, '.constructor')).toEqual([null])
  })

  describe('tool', () => {
    let dir: string
    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'jq-'))
      await writeFile(path.join(dir, 'd.json'), JSON.stringify(data))
      await writeFile(path.join(dir, 'e.jsonl'), '{"a":1}\n\n{"a":2}\n')
      await writeFile(path.join(dir, 'bad.json'), '{oops')
    })
    afterAll(() => rm(dir, { recursive: true, force: true }))

    it('queries a file, JSON Lines and inline JSON', async () => {
      const tool = jsonQueryTool({ root: dir })
      expect(tool.resultTrust).toBe('untrusted')
      expect(
        await run(tool, { path: 'd.json', query: '.items | map(.name)', maxChars: 20000 }),
      ).toEqual({
        count: 1,
        results: [['pen', 'desk', 'lamp']],
        truncated: false,
      })
      expect((await run(tool, { path: 'e.jsonl', query: 'map(.a) | add' })).results).toEqual([3])
      expect((await run(tool, { json: '[1,2]', query: '.[]' })).count).toBe(2)
    })

    it('truncates large results, and rejects bad files, queries and paths', async () => {
      const tool = jsonQueryTool({ root: dir, maxBytes: 100_000 })
      const r = await run(tool, { path: 'd.json', query: '.items[]', maxChars: 100 })
      expect(r).toMatchObject({ count: 3, truncated: true })
      expect(r.results.length).toBeLessThan(3)
      await expect(run(tool, { path: 'bad.json', query: '.' })).rejects.toThrow(/not valid JSON/)
      await expect(run(tool, { path: 'd.json', query: '.[' })).rejects.toThrow(/Query error/)
      await expect(run(tool, { path: '../x.json', query: '.' })).rejects.toThrow()
      await expect(run(tool, { query: '.' })).rejects.toThrow(/exactly one/)
      await expect(run(tool, { path: 'd.json', json: '1', query: '.' })).rejects.toThrow(
        /exactly one/,
      )
      await expect(
        run(jsonQueryTool({ root: dir, maxBytes: 10 }), { path: 'd.json', query: '.' }),
      ).rejects.toThrow(/limit/)
    })
  })
})

describe('memory', () => {
  it('saves, reads, replaces and forgets notes, and outlives the tool', async () => {
    const store = new MemoryKeyValueStore()
    const first = memoryTool({ store })
    expect(await run(first, { action: 'save', key: 'build', value: 'use pnpm, not npm' })).toEqual({
      saved: 'build',
      replaced: false,
    })
    expect(
      (await run(first, { action: 'save', key: 'build', value: 'pnpm run build' })).replaced,
    ).toBe(true)

    // A later run gets a new tool over the same store.
    const later = memoryTool({ store })
    expect(await run(later, { action: 'get', key: 'build' })).toMatchObject({
      key: 'build',
      value: 'pnpm run build',
    })
    expect(await run(later, { action: 'get', key: 'nope' })).toEqual({ key: 'nope', found: false })
    expect(await run(later, { action: 'delete', key: 'build' })).toEqual({
      key: 'build',
      deleted: true,
    })
    expect(await run(later, { action: 'get', key: 'build' })).toMatchObject({ found: false })
  })

  it('searches by keyword, best match first, and lists newest first', async () => {
    const store = new MemoryKeyValueStore()
    const tool = memoryTool({ store })
    await run(tool, { action: 'save', key: 'db', value: 'Postgres 16 runs on port 5433' })
    await run(tool, { action: 'save', key: 'style', value: 'two-space indent, single quotes' })
    await run(tool, {
      action: 'save',
      key: 'ports',
      value: 'dev server on 10100; postgres on 5433',
    })

    const hits = await run(tool, { action: 'search', query: 'postgres PORT' })
    expect(hits.total).toBe(2)
    expect(hits.notes.map((n: { key: string }) => n.key).sort()).toEqual(['db', 'ports'])
    expect((await run(tool, { action: 'search', query: 'indent' })).notes[0].key).toBe('style')
    expect((await run(tool, { action: 'search', query: 'zzz' })).total).toBe(0)
    expect((await run(tool, { action: 'list' })).total).toBe(3)
    await expect(run(tool, { action: 'search', query: '  ' })).rejects.toThrow(/query/)
  })

  it('keeps namespaces apart and leaves other keys in the store alone', async () => {
    const store = new MemoryKeyValueStore()
    await store.set('unrelated', { value: 'x', savedAt: '' })
    const a = memoryTool({ store, namespace: 'a' })
    const b = memoryTool({ store, namespace: 'b' })
    await run(a, { action: 'save', key: 'k', value: 'from a' })
    expect(await run(b, { action: 'get', key: 'k' })).toMatchObject({ found: false })
    expect((await run(b, { action: 'list' })).total).toBe(0)
    expect(await store.get('unrelated')).toBeDefined()
  })

  it('enforces limits and key rules', async () => {
    const tool = memoryTool({ store: new MemoryKeyValueStore(), maxEntries: 2, maxValueChars: 10 })
    await run(tool, { action: 'save', key: 'a', value: 'one' })
    await run(tool, { action: 'save', key: 'b', value: 'two' })
    await expect(run(tool, { action: 'save', key: 'c', value: 'three' })).rejects.toThrow(/full/)
    // Replacing an existing note is still allowed when full.
    await run(tool, { action: 'save', key: 'a', value: 'uno' })
    await expect(run(tool, { action: 'save', key: 'a', value: 'x'.repeat(11) })).rejects.toThrow(
      /limit is 10/,
    )
    await expect(run(tool, { action: 'save', key: '', value: 'v' })).rejects.toThrow(
      /key is required/,
    )
    await expect(run(tool, { action: 'save', key: 'a\nb', value: 'v' })).rejects.toThrow(
      /key is required/,
    )
    await expect(run(tool, { action: 'save', key: 'a' })).rejects.toThrow(/value/)
  })

  it('marks notes untrusted and asks for approval on changes only when configured', async () => {
    const store = new MemoryKeyValueStore()
    const open = memoryTool({ store })
    expect(open.resultTrust).toBe('untrusted')
    expect(open.needsApproval).toBe(false)

    const guarded = memoryTool({ store, approveChanges: true })
    const needs = guarded.needsApproval as (i: unknown, c: unknown) => boolean
    expect(needs({ action: 'save' }, {})).toBe(true)
    expect(needs({ action: 'delete' }, {})).toBe(true)
    expect(needs({ action: 'search' }, {})).toBe(false)
    expect(needs({ action: 'get' }, {})).toBe(false)
  })
})

describe('diff', () => {
  const lines = (...l: string[]) => (l.length ? `${l.join('\n')}\n` : '')

  it('writes a unified diff with context and merged hunks', () => {
    const before = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j')
    const after = lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k')
    expect(
      createUnifiedDiff(before, after, { beforeName: 'x', afterName: 'x', context: 1 }),
    ).toMatchObject({
      added: 2,
      removed: 1,
      identical: false,
      approximate: false,
      patch: '--- x\n+++ x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10 +10,2 @@\n j\n+k\n',
    })
    expect(createUnifiedDiff(before, before)).toMatchObject({ identical: true, patch: '' })
    expect(createUnifiedDiff('', 'x\n').patch).toBe('--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n')
    expect(createUnifiedDiff('x\n', '').patch).toBe('--- a\n+++ b\n@@ -1 +0,0 @@\n-x\n')
  })

  it('notices a changed final newline', () => {
    expect(createUnifiedDiff('a\nb', 'a\nb\n').patch).toBe(
      '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n',
    )
  })

  it('finds a minimal diff', () => {
    // Compare the edit count with the longest common subsequence from plain dynamic programming.
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: rand(14) }, () => 'xyz'[rand(3)] as string)
      const b = Array.from({ length: rand(14) }, () => 'xyz'[rand(3)] as string)
      const table = Array.from({ length: a.length + 1 }, () =>
        new Array<number>(b.length + 1).fill(0),
      )
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
          (table[i] as number[])[j] =
            a[i - 1] === b[j - 1]
              ? ((table[i - 1] as number[])[j - 1] as number) + 1
              : Math.max(
                  (table[i - 1] as number[])[j] as number,
                  (table[i] as number[])[j - 1] as number,
                )
      const lcs = (table[a.length] as number[])[b.length] as number
      const d = createUnifiedDiff(lines(...a), lines(...b), { context: 0 })
      expect(d.removed, `${a} -> ${b}`).toBe(a.length - lcs)
      expect(d.added, `${a} -> ${b}`).toBe(b.length - lcs)
    }
  })

  it('produces patches that apply back to the new text', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'diff-'))
    try {
      const apply = applyPatchTool({ root: dir, approveWrites: false })
      const cases: [string, string][] = [
        [lines('a', 'b', 'c'), lines('a', 'x', 'c', 'd')],
        [
          lines(...'abcdefghijklmnopqrstuvwxyz'.split('')),
          lines(...'abcDefghijklmnopqrsTuvwxyZ'.split('')),
        ],
        ['one\ntwo', 'one\ntwo\nthree\n'],
        ['one\ntwo\n', 'one\ntwo'],
        [lines('same', 'same', 'same'), lines('same', 'same')],
      ]
      for (const [i, [before, after]] of cases.entries()) {
        const file = `f${i}.txt`
        await writeFile(path.join(dir, file), before)
        const { patch } = createUnifiedDiff(before, after, {
          beforeName: `a/${file}`,
          afterName: `b/${file}`,
        })
        await run(apply, { patch })
        expect(await readFile(path.join(dir, file), 'utf8'), file).toBe(after)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('degrades to a whole-region replacement instead of hanging on very different files', () => {
    const a = lines(...Array.from({ length: 4000 }, (_, i) => `a${i}`))
    const b = lines(...Array.from({ length: 4000 }, (_, i) => `b${i}`))
    const d = createUnifiedDiff(a, b)
    expect(d).toMatchObject({ approximate: true, added: 4000, removed: 4000 })
  })

  describe('tool', () => {
    let dir: string
    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'difftool-'))
      await writeFile(path.join(dir, 'old.txt'), lines('1', '2', '3'))
      await writeFile(path.join(dir, 'new.txt'), lines('1', 'two', '3'))
      await writeFile(path.join(dir, 'bin.dat'), 'a\u0000b')
    })
    afterAll(() => rm(dir, { recursive: true, force: true }))

    it('compares files with files, files with text, and text with text', async () => {
      const tool = diffTool({ root: dir })
      const files = await run(tool, { a: { path: 'old.txt' }, b: { path: 'new.txt' } })
      expect(files).toMatchObject({ identical: false, added: 1, removed: 1, truncated: false })
      expect(files.patch).toContain('--- a/old.txt\n+++ b/new.txt\n')
      expect(files.patch).toContain('-2\n+two\n')
      const mixed = await run(tool, { a: { path: 'new.txt' }, b: { text: lines('1', 'two', '3') } })
      expect(mixed.identical).toBe(true)
      expect(
        (await run(tool, { a: { text: 'x\n' }, b: { text: 'y\n' }, context: 0 })).patch,
      ).toContain('-x\n+y')
    })

    it('rejects bad sides, escapes, binary and oversized files, and truncates long patches', async () => {
      const tool = diffTool({ root: dir, maxBytes: 1000 })
      await expect(run(tool, { a: {}, b: { text: 'x' } })).rejects.toThrow(/exactly one/)
      await expect(
        run(tool, { a: { path: 'old.txt', text: 'x' }, b: { text: 'x' } }),
      ).rejects.toThrow(/exactly one/)
      await expect(run(tool, { a: { path: '../etc/passwd' }, b: { text: 'x' } })).rejects.toThrow()
      await expect(run(tool, { a: { path: 'bin.dat' }, b: { text: 'x' } })).rejects.toThrow(
        /binary/,
      )
      await expect(
        run(tool, { a: { text: 'x'.repeat(2000) }, b: { path: 'old.txt' } }),
      ).resolves.toBeDefined()
      await expect(
        run(diffTool({ root: dir, maxBytes: 4 }), { a: { path: 'old.txt' }, b: { text: '' } }),
      ).rejects.toThrow(/limit/)
      const big = await run(tool, {
        a: { text: lines(...Array(300).fill('a')) },
        b: { text: lines(...Array(300).fill('b')) },
        maxChars: 100,
      })
      expect(big).toMatchObject({ truncated: true })
      expect(big.patch).toHaveLength(100)
    })
  })
})
