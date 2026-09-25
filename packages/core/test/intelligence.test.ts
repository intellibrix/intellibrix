import { describe, expect, it } from 'vitest'
import Brick from '../src/brick.js'
import Intelligence, { customProvider } from '../src/intelligence.js'
import { MockProvider, mockTool } from '../src/testing.js'

describe('Intelligence with MockProvider', () => {
  it('should ask a simple question and get a text reply', async () => {
    const provider = new MockProvider([{ text: 'Hello there!' }])
    const intelligence = new Intelligence({ provider, model: 'mock' })
    const brick = new Brick({ intelligence })

    expect(brick.ai).toBeDefined()
    if (!brick.ai) throw new Error('AI not configured')

    const result = await brick.ai.ask('Hi')
    expect(result.text).toEqual('Hello there!')
    expect(result.steps).toEqual(1)
  })

  it('should get the AI to call a tool and use the result', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'return_answer', input: { answer: '84' } }] },
      { text: 'The answer is 84' },
    ])

    const tool = mockTool('return_answer', async (payload: { answer: string }) => {
      expect(payload.answer).toEqual('84')
      return { ...payload, processed: true }
    })

    const intelligence = new Intelligence({ provider, model: 'mock', tools: [tool] })
    const brick = new Brick({ intelligence })
    if (!brick.ai) throw new Error('AI not configured')

    const result = await brick.ai.ask('What is 42 + 42?')
    expect(result.text).toEqual('The answer is 84')
    expect(result.steps).toEqual(2)
  })
})

describe('customProvider', () => {
  it('should run a custom function as a Provider', async () => {
    const provider = customProvider(async (prompt) => `Hello ${prompt}`)
    const intelligence = new Intelligence({ provider, model: 'custom' })
    const brick = new Brick({ intelligence })
    if (!brick.ai) throw new Error('AI not configured')

    const result = await brick.ai.ask('Belisarius Cawl')
    expect(result.text).toEqual('Hello Belisarius Cawl')
  })
})

describe('Intelligence.object', () => {
  it('should force a structured response via a synthetic tool call', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: '_respond_with_schema', input: { answer: 42 } }] },
    ])

    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => ({ value: value as { answer: number } }),
      },
    }

    const intelligence = new Intelligence({ provider, model: 'mock' })
    const result = await intelligence.object<{ answer: number }>(schema, 'What is the answer?')
    expect(result.answer).toEqual(42)
  })
})
