import { describe, expect, it } from 'vitest'
import { textMessage } from '../src/messages.js'
import { type RecordedStep, recordProvider, replayProvider } from '../src/record-replay.js'
import { MockProvider } from '../src/testing.js'

describe('record/replay', () => {
  it('records generate() calls and replays identical StepResults', async () => {
    const inner = new MockProvider([{ text: 'first' }, { text: 'second' }])
    const recorded: RecordedStep[] = []
    const recording = recordProvider(inner, {
      onRecord: (step) => {
        recorded.push(step)
      },
    })

    const req1 = { model: 'mock', messages: [textMessage('user', 'a')] }
    const req2 = { model: 'mock', messages: [textMessage('user', 'b')] }

    const result1 = await recording.generate(req1)
    const result2 = await recording.generate(req2)

    expect(recorded).toHaveLength(2)

    const replay = replayProvider(recorded)
    const replayed1 = await replay.generate(req1)
    const replayed2 = await replay.generate(req2)

    expect(replayed1).toEqual(result1)
    expect(replayed2).toEqual(result2)
  })

  it('strips the abortSignal and reduces tools to name/description in recorded requests', async () => {
    const inner = new MockProvider([{ text: 'ok' }])
    const recorded: RecordedStep[] = []
    const recording = recordProvider(inner, {
      onRecord: (step) => {
        recorded.push(step)
      },
    })

    const controller = new AbortController()
    await recording.generate({
      model: 'mock',
      messages: [textMessage('user', 'hi')],
      abortSignal: controller.signal,
      tools: [
        {
          name: 'my-tool',
          description: 'does a thing',
          input: {
            '~standard': { version: 1, vendor: 'test', validate: (v: unknown) => ({ value: v }) },
          } as any,
          execute: async () => 'unused',
        },
      ],
    })

    expect(recorded[0]?.request).not.toHaveProperty('abortSignal')
    expect(recorded[0]?.request.tools).toEqual([{ name: 'my-tool', description: 'does a thing' }])
  })

  it('replayProvider throws "fixtures exhausted" once fixtures run out', async () => {
    const replay = replayProvider([
      {
        request: { model: 'mock', messages: [] },
        result: { message: { role: 'assistant', content: [] }, finishReason: 'stop' },
      },
    ])
    await replay.generate({ model: 'mock', messages: [] })
    await expect(replay.generate({ model: 'mock', messages: [] })).rejects.toThrow(
      'replayProvider: fixtures exhausted',
    )
  })

  it('replayProvider.stream() replays a text-delta/finish sequence', async () => {
    const replay = replayProvider([
      {
        request: { model: 'mock', messages: [] },
        result: { message: textMessage('assistant', 'hello'), finishReason: 'stop' },
      },
    ])

    const events: string[] = []
    for await (const event of replay.stream({ model: 'mock', messages: [] })) {
      events.push(event.type)
    }

    expect(events).toEqual(['text-delta', 'finish'])
  })
})
