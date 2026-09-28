import { describe, expect, it } from 'vitest'
import type { RunEvent } from '../src/events.js'
import { runAgentLoop } from '../src/loop.js'
import { textMessage } from '../src/messages.js'
import { MockProvider, mockTool } from '../src/testing.js'
import { defineTool } from '../src/tool.js'

const passthroughSchema = {
  '~standard': { version: 1 as const, vendor: 'test', validate: (value: unknown) => ({ value }) },
}

describe('RunEvent sequencing', () => {
  it('emits a full run:start..run:finish sequence for a 2-step tool-call scenario', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'echo', input: { text: 'hi' } }] },
      { text: 'done' },
    ])

    const echo = mockTool('echo', async (input: { text: string }) => input.text)
    const events: RunEvent[] = []

    await runAgentLoop({
      provider,
      model: 'mock',
      messages: [textMessage('user', 'echo hi then finish')],
      tools: [echo],
      onRunEvent: (event) => events.push(event),
    })

    const types = events.map((e) => e.type)
    expect(types[0]).toBe('run:start')
    expect(types).toContain('model:start')
    expect(types).toContain('model:finish')
    expect(types).toContain('tool:call')
    expect(types).toContain('tool:result')
    expect(types[types.length - 1]).toBe('run:finish')

    // model:start/finish must bracket each step, and tool:call/result must
    // occur strictly after the step that produced the tool call.
    const modelStartIdx = types.indexOf('model:start')
    const modelFinishIdx = types.indexOf('model:finish')
    const toolCallIdx = types.indexOf('tool:call')
    expect(modelStartIdx).toBeLessThan(modelFinishIdx)
    expect(modelFinishIdx).toBeLessThan(toolCallIdx)
  })

  it('emits approval:requested/resolved around a denied tool call', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'danger', input: {} }] },
      { text: 'ok, stopped' },
    ])

    const danger = defineTool({
      name: 'danger',
      description: 'A destructive tool',
      input: passthroughSchema as any,
      needsApproval: true,
      execute: async () => 'should not run',
    })

    const events: RunEvent[] = []

    await runAgentLoop({
      provider,
      model: 'mock',
      messages: [textMessage('user', 'try it')],
      tools: [danger],
      onToolApproval: async () => false,
      onRunEvent: (event) => events.push(event),
    })

    const approvalRequested = events.find((e) => e.type === 'approval:requested')
    const approvalResolved = events.find((e) => e.type === 'approval:resolved')
    expect(approvalRequested).toBeDefined()
    expect(approvalResolved).toMatchObject({ decision: false })
  })

  it('emits tool:error when a tool throws', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'boom', input: {} }] },
      { text: 'recovered' },
    ])

    const boom = mockTool('boom', async () => {
      throw new Error('kaboom')
    })

    const events: RunEvent[] = []
    await runAgentLoop({
      provider,
      model: 'mock',
      messages: [textMessage('user', 'go')],
      tools: [boom],
      onRunEvent: (event) => events.push(event),
    })

    const toolError = events.find((e) => e.type === 'tool:error')
    expect(toolError).toBeDefined()
  })
})
