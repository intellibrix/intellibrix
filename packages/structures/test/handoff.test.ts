import { Brick, Intelligence, textMessage } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import { handoffTool } from '../src/handoff.js'

describe('handoffTool', () => {
  it("'delegate' mode: target sees rendered history and returns its reply", async () => {
    const targetProvider = new MockProvider([{ text: 'target handled it' }])
    const target = new Brick({
      name: 'target',
      intelligence: new Intelligence({ provider: targetProvider, model: 'mock' }),
    })

    let capturedHistory: string | undefined

    const history = [textMessage('user', 'original question')]
    const tool = handoffTool({
      to: target,
      getCurrentHistory: () => history,
    })

    const originalExecute = tool.execute
    tool.execute = async (input, ctx) => {
      const result = await originalExecute(input, ctx)
      capturedHistory = 'checked'
      return result
    }

    const sourceProvider = new MockProvider([
      { toolCalls: [{ toolName: tool.name, input: { reason: 'needs specialist' } }] },
      { text: 'source acknowledges handoff' },
    ])
    const source = new Intelligence({ provider: sourceProvider, model: 'mock' })

    const result = await source.ask('help me', { tools: [tool] })

    expect(capturedHistory).toBe('checked')
    expect(result.text).toBe('source acknowledges handoff')
  })

  it("'continue' mode: returns a __handoffContinue sentinel instead of delegating immediately", async () => {
    const targetProvider = new MockProvider([])
    const target = new Brick({
      name: 'target',
      intelligence: new Intelligence({ provider: targetProvider, model: 'mock' }),
    })

    const tool = handoffTool({ to: target, mode: 'continue' })
    const output = await tool.execute({}, { runId: 'run-1' })

    expect(output).toEqual({ __handoffContinue: true, brick: target })
  })

  it("'delegate' mode without getCurrentHistory throws", async () => {
    const target = new Brick({ name: 'target' })
    const tool = handoffTool({ to: target })

    await expect(tool.execute({}, { runId: 'run-1' })).rejects.toThrow(
      'handoffTool: "delegate" mode requires getCurrentHistory',
    )
  })
})
