import { describe, expect, it } from 'vitest'
import Brick from '../src/brick.js'
import { MemoryConversationMemory } from '../src/database.js'
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

describe('Intelligence memory', () => {
  const recording = (steps: ConstructorParameters<typeof MockProvider>[0]) => {
    const provider = new MockProvider(steps)
    const seen: number[] = []
    const generate = provider.generate.bind(provider)
    provider.generate = async (req) => {
      seen.push(req.messages.length)
      return generate(req)
    }
    return { provider, seen }
  }

  it('includes prior turns of the same thread in the next request', async () => {
    const { provider, seen } = recording([{ text: 'first reply' }, { text: 'second reply' }])
    const memory = new MemoryConversationMemory()
    const ai = new Intelligence({ provider, model: 'mock', memory })

    await ai.ask('one', { threadId: 't' })
    await ai.ask('two', { threadId: 't' })

    expect(seen).toEqual([1, 3])
    const stored = await memory.getMessages('t')
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('keeps threads separate', async () => {
    const { provider, seen } = recording([{ text: 'a' }, { text: 'b' }])
    const ai = new Intelligence({ provider, model: 'mock', memory: new MemoryConversationMemory() })

    await ai.ask('one', { threadId: 'a' })
    await ai.ask('one', { threadId: 'b' })

    expect(seen).toEqual([1, 1])
  })

  it('persists tool-call turns from a multi-step run', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'echo', input: { v: 1 } }] },
      { text: 'done' },
    ])
    const memory = new MemoryConversationMemory()
    const ai = new Intelligence({
      provider,
      model: 'mock',
      memory,
      tools: [mockTool('echo', async (input: unknown) => input)],
    })

    await ai.ask('go', { threadId: 't' })
    const roles = (await memory.getMessages('t')).map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('does not touch memory without a threadId, or a threadId without memory', async () => {
    const memory = new MemoryConversationMemory()
    const withMemory = new Intelligence({
      provider: new MockProvider([{ text: 'x' }]),
      model: 'mock',
      memory,
    })
    await withMemory.ask('hi')
    expect(await memory.getMessages('undefined')).toEqual([])

    const without = new Intelligence({ provider: new MockProvider([{ text: 'x' }]), model: 'mock' })
    await expect(without.ask('hi', { threadId: 't' })).resolves.toMatchObject({ text: 'x' })
  })

  it('persists a stream only once it has been fully drained', async () => {
    const memory = new MemoryConversationMemory()
    const ai = new Intelligence({
      provider: new MockProvider([{ text: 'streamed' }, { text: 'abandoned' }]),
      model: 'mock',
      memory,
    })

    for await (const _event of ai.stream('hello', { threadId: 'done' })) {
      // drain
    }
    expect((await memory.getMessages('done')).map((m) => m.role)).toEqual(['user', 'assistant'])

    for await (const _event of ai.stream('hello', { threadId: 'early' })) break
    expect(await memory.getMessages('early')).toEqual([])
  })
})
