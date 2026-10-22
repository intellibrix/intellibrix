import { describe, expect, it } from 'vitest'
import { InMemoryCheckpointer } from '../src/checkpoint.js'
import { runAgentLoop } from '../src/loop.js'
import { MockProvider, mockTool } from '../src/testing.js'

describe('runAgentLoop', () => {
  it('should execute a 2-step scripted tool-call scenario', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'echo', input: { text: 'hi' } }] },
      { text: 'done' },
    ])

    const echo = mockTool('echo', async (input: { text: string }) => input.text)

    const result = await runAgentLoop({
      provider,
      model: 'mock',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      tools: [echo],
    })

    expect(result.steps).toEqual(2)
    const lastMessage = result.messages.at(-1)
    expect(lastMessage?.role).toEqual('assistant')
  })

  it('should deny a tool call gated by needsApproval and let the model react', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'dangerous', input: {} }] },
      { text: 'I will not do that' },
    ])

    const dangerous = { ...mockTool('dangerous', async () => 'boom'), needsApproval: true }

    const result = await runAgentLoop({
      provider,
      model: 'mock',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      tools: [dangerous],
      onToolApproval: async () => false,
    })

    const toolMessage = result.messages.find((m) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    const part = toolMessage?.content[0]
    expect(part && 'isError' in part ? part.isError : undefined).toBe(true)
  })

  it('should thread trust from a tool-call input through to the tool ctx', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'read', input: { path: 'x', trust: 'untrusted' } }] },
      { text: 'done' },
    ])

    let seenTrust: string | undefined
    const read = {
      name: 'read',
      description: 'reads',
      input: mockTool('read', async () => {}).input,
      execute: async (input: any, ctx: any) => {
        seenTrust = ctx.trust
        return input
      },
    }

    await runAgentLoop({
      provider,
      model: 'mock',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      tools: [read],
    })

    expect(seenTrust).toEqual('untrusted')
  })

  it('should save state at each step and resume mid-run from a loaded checkpoint', async () => {
    const checkpointer = new InMemoryCheckpointer()
    const runId = 'test-run'

    await checkpointer.save(runId, {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'partial' }] },
      ],
      stepIndex: 1,
    })

    const resumedProvider = new MockProvider([{ text: 'resumed reply' }])

    const result = await runAgentLoop({
      provider: resumedProvider,
      model: 'mock',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ignored, resume overrides' }] }],
      checkpointer,
      runId,
      resume: true,
    })

    expect(result.messages[0]?.role).toEqual('user')
    expect(result.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'resumed reply' }],
    })

    const saved = await checkpointer.load(runId)
    expect(saved?.stepIndex).toBeGreaterThan(1)
  })
})
