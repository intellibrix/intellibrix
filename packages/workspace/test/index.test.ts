import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Intelligence, type ToolDefinition, validateToolInput } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JailEscapeError, resolveJailed, workspaceTools } from '../src/index.js'

let root: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'ws-root-')))
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'ws-out-')))
  await writeFile(path.join(outside, 'secret.txt'), 'top secret')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

const byName = (tools: ToolDefinition[], name: string) => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool
}
const run = async (tool: ToolDefinition, input: unknown) =>
  tool.execute(await validateToolInput(tool, input), { runId: 'test' })

describe('resolveJailed', () => {
  it('resolves paths inside the root, including not-yet-existing ones', async () => {
    expect(await resolveJailed(root, 'a/b.txt')).toBe(path.join(root, 'a/b.txt'))
    expect(await resolveJailed(root, '.')).toBe(root)
  })

  it('rejects .. traversal and absolute paths outside the root', async () => {
    await expect(resolveJailed(root, '../x')).rejects.toBeInstanceOf(JailEscapeError)
    await expect(resolveJailed(root, 'a/../../x')).rejects.toBeInstanceOf(JailEscapeError)
    await expect(resolveJailed(root, path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(
      JailEscapeError,
    )
  })

  it('rejects a symlinked file pointing outside', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
    await expect(resolveJailed(root, 'link.txt')).rejects.toBeInstanceOf(JailEscapeError)
  })

  it('rejects a symlinked directory, even for files that do not exist yet', async () => {
    await symlink(outside, path.join(root, 'linkdir'))
    await expect(resolveJailed(root, 'linkdir/secret.txt')).rejects.toBeInstanceOf(JailEscapeError)
    await expect(resolveJailed(root, 'linkdir/new.txt')).rejects.toBeInstanceOf(JailEscapeError)
  })

  it('allows a symlink that stays inside the root', async () => {
    await mkdir(path.join(root, 'real'))
    await symlink(path.join(root, 'real'), path.join(root, 'alias'))
    expect(await resolveJailed(root, 'alias')).toBe(path.join(root, 'real'))
  })
})

describe('fs tools', () => {
  it('reads, lists, globs and greps; results are untrusted', async () => {
    const tools = workspaceTools({ root, git: false })
    await writeFile(path.join(root, 'a.ts'), 'const x = 1\nconst y = 2\n')
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n')
    await writeFile(path.join(root, 'ignored.ts'), 'const x = 9\n')

    expect(await run(byName(tools, 'read_file'), { path: 'a.ts' })).toEqual({
      path: 'a.ts',
      content: 'const x = 1\nconst y = 2\n',
    })
    expect(byName(tools, 'read_file').resultTrust).toBe('untrusted')
    expect(await run(byName(tools, 'glob'), { pattern: '**/*.ts' })).toEqual(['a.ts'])
    expect(await run(byName(tools, 'grep'), { pattern: 'const y' })).toEqual([
      { file: 'a.ts', line: 2, text: 'const y = 2' },
    ])
    expect(await run(byName(tools, 'list_dir'), { path: '.' })).toContainEqual({
      name: 'a.ts',
      type: 'file',
    })
  })

  it('refuses to read through an escaping symlink', async () => {
    const tools = workspaceTools({ root, git: false })
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
    await expect(run(byName(tools, 'read_file'), { path: 'link.txt' })).rejects.toBeInstanceOf(
      JailEscapeError,
    )
  })

  it('grep skips escaping symlinks instead of leaking them', async () => {
    const tools = workspaceTools({ root, git: false })
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
    expect(await run(byName(tools, 'grep'), { pattern: 'secret' })).toEqual([])
  })

  it('write_file creates parents; edit_file requires exactly one match', async () => {
    const tools = workspaceTools({ root, git: false })
    await run(byName(tools, 'write_file'), { path: 'd/e.txt', content: 'one two one' })
    expect(await readFile(path.join(root, 'd/e.txt'), 'utf8')).toBe('one two one')
    await expect(
      run(byName(tools, 'edit_file'), { path: 'd/e.txt', oldString: 'one', newString: 'x' }),
    ).rejects.toThrow(/exactly once; found 2/)
    await expect(
      run(byName(tools, 'edit_file'), { path: 'd/e.txt', oldString: 'zzz', newString: 'x' }),
    ).rejects.toThrow(/found 0/)
    await run(byName(tools, 'edit_file'), { path: 'd/e.txt', oldString: 'two', newString: '$&' })
    expect(await readFile(path.join(root, 'd/e.txt'), 'utf8')).toBe('one $& one')
  })

  it('cannot write through a symlinked directory', async () => {
    const tools = workspaceTools({ root, git: false })
    await symlink(outside, path.join(root, 'linkdir'))
    await expect(
      run(byName(tools, 'write_file'), { path: 'linkdir/pwn.txt', content: 'x' }),
    ).rejects.toBeInstanceOf(JailEscapeError)
  })
})

describe('shell tool', () => {
  const tools = () => workspaceTools({ root, git: false, shell: { allow: ['node', 'sleep'] } })

  it('runs allowlisted binaries and captures output', async () => {
    const r = await run(byName(tools(), 'shell'), {
      command: 'node',
      args: ['-e', 'console.log("hi")'],
    })
    expect(r).toMatchObject({ stdout: 'hi\n', exitCode: 0, timedOut: false })
  })

  it('rejects non-allowlisted binaries, including by path', async () => {
    await expect(run(byName(tools(), 'shell'), { command: 'ls' })).rejects.toThrow(/not allowed/)
    await expect(run(byName(tools(), 'shell'), { command: '/bin/ls' })).rejects.toThrow(
      /not allowed/,
    )
  })

  it('does not interpret shell metacharacters', async () => {
    const r = await run(byName(tools(), 'shell'), {
      command: 'node',
      args: ['-e', 'console.log(process.argv[1])', '; echo pwned'],
    })
    expect(r.stdout).toBe('; echo pwned\n')
  })

  it('honors timeouts', async () => {
    const r = await run(byName(tools(), 'shell'), { command: 'sleep', args: ['5'], timeoutMs: 100 })
    expect(r.timedOut).toBe(true)
  })

  it('rejects cwd outside the root', async () => {
    await expect(
      run(byName(tools(), 'shell'), { command: 'node', args: ['-v'], cwd: '..' }),
    ).rejects.toBeInstanceOf(JailEscapeError)
  })
})

describe('git tools', () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  beforeEach(() => {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
  })

  it('reports status, diff, commits and branches', async () => {
    const tools = workspaceTools({ root })
    await writeFile(path.join(root, 'f.txt'), 'hello\n')
    expect((await run(byName(tools, 'git_status'), {})).untracked).toEqual(['f.txt'])

    await run(byName(tools, 'git_commit'), { message: 'feat: add f' })
    expect(git('log', '--format=%s').trim()).toBe('feat: add f')

    await writeFile(path.join(root, 'f.txt'), 'hello\nworld\n')
    expect((await run(byName(tools, 'git_diff'), {})).diff).toContain('+world')

    const b = await run(byName(tools, 'git_branch'), { create: 'topic' })
    expect(b.current).toBe('topic')
  })
})

describe('approval gates', () => {
  it('flags every mutating tool as needing approval by default', () => {
    const tools = workspaceTools({ root, shell: { allow: ['node'] } })
    for (const name of ['write_file', 'edit_file', 'shell', 'git_commit']) {
      expect(byName(tools, name).needsApproval, name).toBe(true)
    }
    for (const name of ['read_file', 'list_dir', 'glob', 'grep', 'git_status', 'git_diff']) {
      expect(byName(tools, name).needsApproval, name).toBeFalsy()
    }
    expect(
      workspaceTools({ root, shell: { allow: ['node'], alwaysApprove: true } }).find(
        (t) => t.name === 'shell',
      )?.needsApproval,
    ).toBe(false)
  })

  it('denies a write when the approval hook says no, and leaves the file untouched', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'write_file', input: { path: 'x.txt', content: 'nope' } }] },
      { text: 'ok' },
    ])
    const ai = new Intelligence({
      provider,
      model: 'mock',
      tools: workspaceTools({ root, git: false }),
      onToolApproval: () => false,
    })
    await ai.ask('write it')
    await expect(readFile(path.join(root, 'x.txt'))).rejects.toThrow(/ENOENT/)
  })

  it('performs the write when approved', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'write_file', input: { path: 'x.txt', content: 'yes' } }] },
      { text: 'ok' },
    ])
    const ai = new Intelligence({
      provider,
      model: 'mock',
      tools: workspaceTools({ root, git: false }),
      onToolApproval: () => true,
    })
    await ai.ask('write it')
    expect(await readFile(path.join(root, 'x.txt'), 'utf8')).toBe('yes')
  })
})
