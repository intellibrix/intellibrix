import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Intelligence, type ToolDefinition, validateToolInput } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  agentTools,
  applyPatchTool,
  detectChecks,
  parseUnifiedDiff,
  runChecksTool,
  TodoStore,
  todoTool,
} from '../src/index.js'

let root: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'at-root-')))
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'at-out-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

const run = async (tool: ToolDefinition, input: unknown, runId = 'test') =>
  tool.execute(await validateToolInput(tool, input), { runId })
const put = (file: string, text: string) => writeFile(path.join(root, file), text)
const get = (file: string) => readFile(path.join(root, file), 'utf8')
const missing = (file: string) =>
  get(file).then(
    () => false,
    () => true,
  )

describe('apply_patch', () => {
  const tool = () => applyPatchTool({ root })

  it('modifies a file, locating hunks by context even with wrong line numbers', async () => {
    await put('a.txt', 'one\ntwo\nthree\nfour\nfive\n')
    const r = await run(tool(), {
      patch: '--- a/a.txt\n+++ b/a.txt\n@@ -40,3 +40,3 @@\n three\n-four\n+FOUR\n five\n',
    })
    expect(await get('a.txt')).toBe('one\ntwo\nthree\nFOUR\nfive\n')
    expect(r).toEqual({
      applied: true,
      files: [{ path: 'a.txt', action: 'modify', hunks: 1, added: 1, removed: 1 }],
    })
  })

  it('applies several hunks and several files', async () => {
    await put('a.txt', 'a1\na2\na3\na4\na5\na6\na7\na8\n')
    await put('b.txt', 'b1\nb2\n')
    await run(tool(), {
      patch: [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,2 +1,3 @@',
        ' a1',
        '+inserted',
        ' a2',
        '@@ -7,2 +8,1 @@',
        ' a7',
        '-a8',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1,2 +1,2 @@',
        '-b1',
        '+B1',
        ' b2',
        '',
      ].join('\n'),
    })
    expect(await get('a.txt')).toBe('a1\ninserted\na2\na3\na4\na5\na6\na7\n')
    expect(await get('b.txt')).toBe('B1\nb2\n')
  })

  it('creates and deletes files', async () => {
    await put('gone.txt', 'x\ny\n')
    const r = await run(tool(), {
      patch:
        '--- /dev/null\n+++ b/new/dir/f.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-x\n-y\n',
    })
    expect(await get('new/dir/f.txt')).toBe('hello\nworld\n')
    expect(await missing('gone.txt')).toBe(true)
    expect((r.files as { action: string }[]).map((f) => f.action)).toEqual(['create', 'delete'])
  })

  it('renames a file while editing it', async () => {
    await put('old.txt', 'a\nb\n')
    await run(tool(), { patch: '--- old.txt\n+++ new.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n' })
    expect(await get('new.txt')).toBe('a\nB\n')
    expect(await missing('old.txt')).toBe(true)
  })

  it('is all or nothing: one bad hunk leaves every file untouched', async () => {
    await put('a.txt', 'a\n')
    await put('b.txt', 'b\n')
    await expect(
      run(tool(), {
        patch:
          '--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-a\n+A\n--- b.txt\n+++ b.txt\n@@ -1 +1 @@\n-nope\n+B\n',
      }),
    ).rejects.toThrow(/Hunk 1 of b\.txt does not apply/)
    expect(await get('a.txt')).toBe('a\n')
    expect(await get('b.txt')).toBe('b\n')
  })

  it('check mode validates without writing', async () => {
    await put('a.txt', 'a\n')
    const r = await run(tool(), {
      patch: '--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-a\n+A\n',
      check: true,
    })
    expect(r).toMatchObject({ applied: false, checked: true })
    expect(await get('a.txt')).toBe('a\n')
  })

  it('preserves CRLF line endings and a missing final newline', async () => {
    await put('w.txt', 'a\r\nb\r\n')
    await run(tool(), { patch: '--- w.txt\n+++ w.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n' })
    expect(await get('w.txt')).toBe('a\r\nB\r\n')

    await put('n.txt', 'a\nb')
    await run(tool(), {
      patch:
        '--- n.txt\n+++ n.txt\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n',
    })
    expect(await get('n.txt')).toBe('a\nB')
  })

  it('accepts blank context lines whose leading space was stripped', async () => {
    await put('s.txt', 'a\n\nb\n')
    await run(tool(), { patch: '--- s.txt\n+++ s.txt\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n' })
    expect(await get('s.txt')).toBe('a\n\nB\n')
  })

  it('refuses to create an existing file or patch a missing one', async () => {
    await put('a.txt', 'a\n')
    await expect(
      run(tool(), { patch: '--- /dev/null\n+++ a.txt\n@@ -0,0 +1 @@\n+x\n' }),
    ).rejects.toThrow(/already exists/)
    await expect(
      run(tool(), { patch: '--- nope.txt\n+++ nope.txt\n@@ -1 +1 @@\n-a\n+b\n' }),
    ).rejects.toThrow(/does not exist/)
  })

  it('stays inside the workspace, including through symlinks', async () => {
    await expect(
      run(tool(), { patch: '--- /dev/null\n+++ ../escape.txt\n@@ -0,0 +1 @@\n+x\n' }),
    ).rejects.toThrow(/escapes the workspace/)
    await symlink(outside, path.join(root, 'link'))
    await expect(
      run(tool(), { patch: '--- /dev/null\n+++ link/pwn.txt\n@@ -0,0 +1 @@\n+x\n' }),
    ).rejects.toThrow(/escapes the workspace/)
    expect(await readFile(path.join(outside, 'pwn.txt')).catch(() => null)).toBeNull()
  })

  it('requires approval by default, and rejects empty patches', async () => {
    expect(tool().needsApproval).toBe(true)
    expect(applyPatchTool({ root, approveWrites: false }).needsApproval).toBe(false)
    await expect(run(tool(), { patch: 'just words' })).rejects.toThrow(/No file changes/)
  })

  it('parses headers with timestamps and git prefixes', () => {
    const [f] = parseUnifiedDiff(
      '--- a/x.ts\t2024-01-01\n+++ b/x.ts\t2024-01-02\n@@ -1 +1 @@\n-a\n+b\n',
    )
    expect(f).toMatchObject({ oldPath: 'a/x.ts', newPath: 'b/x.ts' })
  })
})

describe('run_checks', () => {
  const node = (script: string) => ({ command: process.execPath, args: ['-e', script] })

  it('reports passing checks tersely', async () => {
    const r = await run(runChecksTool({ root, checks: { test: node('console.log("fine")') } }), {})
    expect(r).toMatchObject({
      ok: true,
      results: [{ name: 'test', ok: true, exitCode: 0, failures: [], output: '' }],
    })
  })

  it('parses tsc, generic and vitest-style failures, and strips colors', async () => {
    const script = `console.error(
      "\\u001b[31msrc/a.ts(3,5): error TS2322: Type 'x' is not assignable.\\u001b[0m\\n" +
      "src/b.ts:10:2 - error TS1005: ';' expected.\\n" +
      "lib/c.js:7:1: no-unused-vars 'y' is unused\\n" +
      " FAIL  test/d.test.ts > suite > does a thing\\n"); process.exit(2)`
    const r = await run(runChecksTool({ root, checks: { typecheck: node(script) } }), {})
    expect(r.ok).toBe(false)
    const [res] = r.results
    expect(res.exitCode).toBe(2)
    expect(res.failures).toEqual([
      { file: 'src/a.ts', line: 3, column: 5, message: "TS2322: Type 'x' is not assignable." },
      { file: 'src/b.ts', line: 10, column: 2, message: "TS1005: ';' expected." },
      { file: 'lib/c.js', line: 7, column: 1, message: "no-unused-vars 'y' is unused" },
      { file: 'test/d.test.ts', message: 'test failed: suite > does a thing' },
    ])
    expect(res.output).not.toContain('\u001b')
  })

  it('supports custom parsers, selecting checks, and unknown names', async () => {
    const tool = runChecksTool({
      root,
      checks: {
        a: {
          ...node('console.log("boom"); process.exit(1)'),
          parse: (o) => [{ message: o.trim() }],
        },
        b: node(''),
      },
    })
    const r = await run(tool, { checks: ['a'] })
    expect(r.results).toHaveLength(1)
    expect(r.results[0].failures).toEqual([{ message: 'boom' }])
    await expect(run(tool, { checks: ['zzz'] })).rejects.toThrow(
      /Unknown check: zzz\. Available: a, b/,
    )
  })

  it('times out and reports spawn failures', async () => {
    const r = await run(
      runChecksTool({
        root,
        checks: {
          slow: { ...node('setTimeout(()=>{}, 5000)'), timeoutMs: 100 },
          missing: { command: 'definitely-not-a-binary' },
        },
      }),
      {},
    )
    expect(r.results[0]).toMatchObject({ name: 'slow', ok: false, timedOut: true })
    expect(r.results[1]).toMatchObject({ name: 'missing', ok: false, exitCode: -1 })
  })

  it('detects checks from package.json and the lockfile', async () => {
    expect(await detectChecks(root)).toEqual({})
    await put(
      'package.json',
      JSON.stringify({
        scripts: { test: 'vitest run', 'type-check': 'tsc', lint: 'biome ci', dev: 'x' },
      }),
    )
    await put('pnpm-lock.yaml', '')
    expect(await detectChecks(root)).toEqual({
      test: { command: 'pnpm', args: ['run', 'test'], parse: undefined },
      typecheck: { command: 'pnpm', args: ['run', 'type-check'], parse: 'tsc' },
      lint: { command: 'pnpm', args: ['run', 'lint'], parse: undefined },
    })
    await expect(run(runChecksTool({ root: outside }), {})).rejects.toThrow(/No checks/)
  })

  it('requires approval by default, and keeps cwd inside the root', async () => {
    expect(runChecksTool({ root }).needsApproval).toBe(true)
    expect(runChecksTool({ root, alwaysApprove: true }).needsApproval).toBe(false)
    await mkdir(path.join(root, 'sub'))
    const r = await run(
      runChecksTool({
        root,
        checks: { here: { ...node('console.log(process.cwd())'), cwd: 'sub' } },
      }),
      {},
    )
    expect(r.ok).toBe(true)
    await expect(
      run(runChecksTool({ root, checks: { bad: { command: 'node', cwd: '..' } } }), {}),
    ).rejects.toThrow(/escapes the workspace/)
  })
})

describe('todo', () => {
  it('replaces the list, reads it back, and scopes it to the run', async () => {
    const seen: string[] = []
    const tool = todoTool({ onChange: (runId) => seen.push(runId) })
    const r = await run(
      tool,
      {
        todos: [
          { content: 'plan', status: 'completed' },
          { content: 'build', status: 'in_progress' },
          { content: 'ship', status: 'pending' },
        ],
      },
      'r1',
    )
    expect(r).toMatchObject({ pending: 1, inProgress: 1, completed: 1 })
    expect(r.todos.map((t: { id: string }) => t.id)).toEqual(['1', '2', '3'])
    expect(await run(tool, {}, 'r1')).toEqual(r)
    expect(await run(tool, {}, 'r2')).toMatchObject({ todos: [] })
    expect(tool.store.get('r1')).toHaveLength(3)
    expect(seen).toEqual(['r1'])
  })

  it('allows only one task in progress', async () => {
    await expect(
      run(todoTool(), {
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
        ],
      }),
    ).rejects.toThrow(/Only one task/)
  })

  it('uses a supplied store', async () => {
    const store = new TodoStore()
    await run(todoTool({ store }), { todos: [{ content: 'a', status: 'pending' }] }, 'x')
    expect(store.get('x')).toEqual([{ id: '1', content: 'a', status: 'pending' }])
  })
})

describe('agentTools', () => {
  it('bundles the tools and lets each be left out', () => {
    expect(agentTools({ root }).map((t) => t.name)).toEqual(['apply_patch', 'run_checks', 'todo'])
    expect(agentTools({ root, checks: false, todo: false }).map((t) => t.name)).toEqual([
      'apply_patch',
    ])
  })

  it('drives an edit, check, plan loop through the agent loop', async () => {
    await put('a.txt', 'a\n')
    const provider = new MockProvider([
      {
        toolCalls: [
          { toolName: 'todo', input: { todos: [{ content: 'fix a', status: 'in_progress' }] } },
          {
            toolName: 'apply_patch',
            input: { patch: '--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-a\n+A\n' },
          },
        ],
      },
      { text: 'done' },
    ])
    const ai = new Intelligence({
      provider,
      model: 'mock',
      tools: agentTools({ root, approveWrites: false }),
    })
    await ai.ask('fix it')
    expect(await get('a.txt')).toBe('A\n')
  })
})
