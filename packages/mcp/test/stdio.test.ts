import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mcpTools } from '../src/index.js'

const fixture = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url))
const built = existsSync(fileURLToPath(new URL('../dist/index.mjs', import.meta.url)))

describe('stdio transport', () => {
  // Spawns a real subprocess against the built package, so it needs `pnpm build` first (CI does this).
  it.skipIf(!built)('serves and mounts over a spawned stdio process', async () => {
    const mounted = await mcpTools({
      transport: 'stdio',
      command: process.execPath,
      args: [fixture],
      env: { INTELLIBRIX_LOG_STDERR: '1' },
    })

    try {
      expect(mounted.tools.map((tool) => tool.name)).toEqual(['shout'])
      expect(await mounted.tools[0]?.execute({ text: 'hi' }, { runId: 'r' })).toBe('HI')
    } finally {
      await mounted.close()
    }
  })
})
