import { Intelligence, validateToolInput } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import {
  type CloudflareSandboxHandle,
  cloudflareProvider,
  importVendor,
  type Sandbox,
  type SandboxProvider,
  sandboxTool,
} from '../src/index.js'

function fakeProvider() {
  const log = { created: 0, closed: 0, ran: [] as string[] }
  const provider: SandboxProvider = {
    id: 'fake',
    async create() {
      log.created++
      const sandbox: Sandbox = {
        async runCode(code, opts) {
          log.ran.push(`${opts?.language ?? '-'}:${code}`)
          return { stdout: `ran ${code}`, stderr: '', exitCode: 0 }
        },
        async close() {
          log.closed++
        },
      }
      return sandbox
    },
  }
  return { provider, log }
}

const call = async (tool: ReturnType<typeof sandboxTool>, input: unknown, runId = 'r1') =>
  tool.execute(await validateToolInput(tool, input), { runId })

describe('sandboxTool', () => {
  it('requires approval by default and marks results untrusted', () => {
    const tool = sandboxTool(fakeProvider().provider)
    expect(tool.name).toBe('run_code')
    expect(tool.needsApproval).toBe(true)
    expect(tool.resultTrust).toBe('untrusted')
    expect(sandboxTool(fakeProvider().provider, { alwaysApprove: true }).needsApproval).toBe(false)
  })

  it('round-trips run_code', async () => {
    const { provider, log } = fakeProvider()
    const tool = sandboxTool(provider)
    expect(await call(tool, { code: '1+1', language: 'python' })).toEqual({
      stdout: 'ran 1+1',
      stderr: '',
      exitCode: 0,
    })
    expect(log.ran).toEqual(['python:1+1'])
  })

  it('reuses one sandbox per run and isolates runs', async () => {
    const { provider, log } = fakeProvider()
    const tool = sandboxTool(provider)
    await Promise.all([call(tool, { code: 'a' }), call(tool, { code: 'b' })])
    await call(tool, { code: 'c' }, 'r2')
    expect(log.created).toBe(2)
    await tool.closeRun('r1')
    expect(log.closed).toBe(1)
    await tool.closeAll()
    expect(log.closed).toBe(2)
  })

  it('does not cache a failed create', async () => {
    let n = 0
    const { provider } = fakeProvider()
    const flaky: SandboxProvider = {
      id: 'flaky',
      create: async (o) => {
        if (n++ === 0) throw new Error('no capacity')
        return provider.create(o)
      },
    }
    const tool = sandboxTool(flaky)
    await expect(call(tool, { code: 'x' })).rejects.toThrow('no capacity')
    expect((await call(tool, { code: 'x' })).exitCode).toBe(0)
  })

  it('is gated by the approval hook inside an agent loop', async () => {
    const { provider, log } = fakeProvider()
    const ai = new Intelligence({
      provider: new MockProvider([
        { toolCalls: [{ toolName: 'run_code', input: { code: 'rm -rf /' } }] },
        { text: 'done' },
      ]),
      model: 'mock',
      tools: [sandboxTool(provider)],
      onToolApproval: () => false,
    })
    await ai.ask('go')
    expect(log.created).toBe(0)
  })
})

describe('vendor adapters', () => {
  it('importVendor fails with an actionable error when the SDK is missing', async () => {
    await expect(
      importVendor('@intellibrix/definitely-not-installed', 'someProvider'),
    ).rejects.toThrow(
      /requires the optional peer dependency "@intellibrix\/definitely-not-installed"/,
    )
  })

  it('cloudflare adapter writes then executes through the handle', async () => {
    const calls: string[] = []
    const handle: CloudflareSandboxHandle = {
      writeFile: async (p, c) => void calls.push(`write ${p}: ${c}`),
      exec: async (cmd) => (calls.push(`exec ${cmd}`), { stdout: 'ok', stderr: '', exitCode: 0 }),
    }
    const sbx = await cloudflareProvider(() => handle).create()
    expect((await sbx.runCode('print(1)')).stdout).toBe('ok')
    expect(calls).toEqual(['write /tmp/run.py: print(1)', 'exec python3 /tmp/run.py'])
    await expect(sbx.runCode('x', { language: 'cobol' })).rejects.toThrow(/supports/)
  })
})
