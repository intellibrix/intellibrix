import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mcpTools } from '@intellibrix/mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { init, loadEntry, runCli, SCAFFOLD_VERSION } from '../src/index.js'

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name)
let dirs: string[] = []
const tmp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), 'ibx-cli-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('init', () => {
  it('scaffolds a project pinned to the release', async () => {
    const dir = path.join(await tmp(), 'my-app')
    await init(dir)
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('my-app')
    expect(pkg.dependencies.intellibrix).toBe(SCAFFOLD_VERSION)
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n')
    expect(await readFile(path.join(dir, 'src/index.ts'), 'utf8')).toContain('export default brick')
  })

  it('refuses a non-empty directory unless forced', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, 'keep.txt'), 'x')
    await expect(init(dir)).rejects.toThrow(/not empty/)
    await init(dir, { force: true })
    expect(await readFile(path.join(dir, 'keep.txt'), 'utf8')).toBe('x')
  })

  it('accepts an existing empty directory', async () => {
    const dir = await tmp()
    await mkdir(path.join(dir, 'sub'))
    await init(path.join(dir, 'sub'))
  })
})

describe('mcp serve', () => {
  it('loads a TS entry and answers real MCP calls over http', async () => {
    const handle = await runCli([
      'mcp',
      'serve',
      fixture('brick.ts'),
      '--transport',
      'http',
      '--port',
      '0',
    ])
    expect(handle?.url).toBeTruthy()
    const client = await mcpTools({ transport: 'http', url: handle?.url as string })
    try {
      const double = client.tools.find((t) => t.name === 'double')
      expect(double).toBeTruthy()
      const out = await double?.execute({ n: 21 }, { runId: 'r' })
      expect(JSON.stringify(out)).toContain('42')
    } finally {
      await client.close()
      await handle?.close()
    }
  })

  it('rejects an entry that is not a Brick or Structure', async () => {
    await expect(loadEntry(fixture('not-a-brick.ts'))).rejects.toThrow(
      /default-export a Brick or Structure/,
    )
  })

  it('validates arguments', async () => {
    await expect(runCli(['mcp', 'serve'])).rejects.toThrow(/entry file/)
    await expect(runCli(['mcp', 'serve', 'x.ts', '--transport', 'ws'])).rejects.toThrow(
      /--transport/,
    )
    await expect(runCli(['bogus'])).rejects.toThrow(/Unknown command/)
  })
})
