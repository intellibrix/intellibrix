import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import { DepthExceededError } from '../src/limits.js'
import { supervisor } from '../src/supervisor.js'

function makeBrick(name: string, reply: string) {
  return new Brick({
    name,
    intelligence: new Intelligence({
      provider: new MockProvider([{ text: reply }]),
      model: 'mock',
    }),
  })
}

describe('supervisor', () => {
  it('delegates to a sub-brick via a scripted tool call and returns the final reply', async () => {
    const worker = makeBrick('worker', 'worker did the task')
    const supervisorProvider = new MockProvider([
      { toolCalls: [{ toolName: 'worker', input: { prompt: 'go' } }] },
      { text: 'supervisor summary' },
    ])

    const s = supervisor({
      supervisor: new Intelligence({ provider: supervisorProvider, model: 'mock' }),
      bricks: [worker],
    })

    const result = await s.ask('please handle this')
    expect(result.text).toBe('supervisor summary')
  })

  it('supports a 3-level supervisor chain (supervisor -> mid -> leaf)', async () => {
    const leaf = makeBrick('leaf', 'leaf result')

    const midProvider = new MockProvider([
      { toolCalls: [{ toolName: 'leaf', input: { prompt: 'leaf task' } }] },
      { text: 'mid summary' },
    ])
    const midIntelligence = new Intelligence({ provider: midProvider, model: 'mock' })
    const mid = new Brick({ name: 'mid', intelligence: midIntelligence })

    // mid delegates to leaf using its own ask(), wired with leaf as a tool
    const originalAsk = mid.ask.bind(mid)
    mid.ask = async (prompt: string, options = {}) => {
      return originalAsk(prompt, {
        ...options,
        tools: [
          ...(options.tools ?? []),
          {
            name: 'leaf',
            description: 'leaf',
            input: {
              '~standard': {
                version: 1,
                vendor: 'intellibrix',
                validate: (v: unknown) => ({ value: v }),
              },
            } as any,
            execute: async (input: { prompt: string }) => (await leaf.ask(input.prompt)).text,
          },
        ],
      })
    }

    const topProvider = new MockProvider([
      { toolCalls: [{ toolName: 'mid', input: { prompt: 'top task' } }] },
      { text: 'top summary' },
    ])

    const top = supervisor({
      supervisor: new Intelligence({ provider: topProvider, model: 'mock' }),
      bricks: [mid],
    })

    const result = await top.ask('kick off the chain')
    expect(result.text).toBe('top summary')
  })

  it('throws DepthExceededError when maxDepth is exceeded', async () => {
    const worker = makeBrick('worker', 'unused')
    const supervisorProvider = new MockProvider([])

    const s = supervisor({
      supervisor: new Intelligence({ provider: supervisorProvider, model: 'mock' }),
      bricks: [worker],
      maxDepth: 0,
    })

    await expect(s.ask('anything')).rejects.toThrow(DepthExceededError)
  })
})
