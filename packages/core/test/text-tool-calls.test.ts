import { describe, expect, it } from 'vitest'
import Intelligence from '../src/intelligence.js'
import { isToolCallPart, textMessage } from '../src/messages.js'
import type { GenerateRequest, Provider, StepResult, StreamEvent } from '../src/provider.js'
import { hermesToolCalls, pythonicToolCalls, textToolCalls } from '../src/text-tool-calls.js'
import { defineTool } from '../src/tool.js'

const reply = (text: string): StepResult => ({
  message: textMessage('assistant', text),
  finishReason: 'stop',
})

/** A provider that answers each step with the next scripted text, streaming it in `chunk`-sized deltas. */
const scripted = (texts: string[], chunk = 7): Provider => {
  let i = 0
  return {
    id: 'scripted',
    async generate() {
      return reply(texts[i++] ?? '')
    },
    async *stream(): AsyncIterable<StreamEvent> {
      const text = texts[i++] ?? ''
      for (let n = 0; n < text.length; n += chunk)
        yield { type: 'text-delta', text: text.slice(n, n + chunk) }
      yield { type: 'finish', result: reply(text) }
    },
  }
}

const req = (names: string[] = ['read_file']): GenerateRequest => ({
  model: 'm',
  messages: [textMessage('user', 'hi')],
  tools: names.map((name) =>
    defineTool({ name, description: name, input: undefined as never, execute: async () => null }),
  ),
})

const calls = (r: StepResult) =>
  r.message.content.filter(isToolCallPart).map((c) => [c.toolName, c.input])

describe('pythonicToolCalls', () => {
  it('parses kwargs of every literal type, multiple calls, and leaves surrounding text', () => {
    const { calls, text } = pythonicToolCalls.parse(
      `Sure.<|tool_call_start|>[a(s='it\\'s', d="x\\ny", n=-1.5e2, ok=True, no=False, z=None, l=[1, 'b'], m={'k': (1, 2)}), b()]<|tool_call_end|>Done`,
    )
    expect(text).toBe('Sure.Done')
    expect(calls).toEqual([
      {
        toolName: 'a',
        input: {
          s: "it's",
          d: 'x\ny',
          n: -150,
          ok: true,
          no: false,
          z: null,
          l: [1, 'b'],
          m: { k: [1, 2] },
        },
      },
      { toolName: 'b', input: {} },
    ])
  })

  it('leaves malformed blocks untouched', () => {
    const block = "<|tool_call_start|>[a(x='unterminated)]<|tool_call_end|>"
    expect(pythonicToolCalls.parse(block)).toEqual({ calls: [], text: block })
  })
})

describe('hermesToolCalls', () => {
  it('parses arguments/parameters and string-encoded arguments', () => {
    const { calls, text } = hermesToolCalls.parse(
      `<tool_call>{"name":"a","arguments":{"x":1}}</tool_call> and <tool_call>{"name":"b","parameters":"{\\"y\\":2}"}</tool_call>`,
    )
    expect(text).toBe(' and ')
    expect(calls).toEqual([
      { toolName: 'a', input: { x: 1 } },
      { toolName: 'b', input: { y: 2 } },
    ])
  })

  it('leaves invalid JSON untouched', () => {
    const block = '<tool_call>{nope}</tool_call>'
    expect(hermesToolCalls.parse(block)).toEqual({ calls: [], text: block })
  })
})

describe('textToolCalls', () => {
  it('lifts text calls into real tool-call parts on generate()', async () => {
    const p = textToolCalls(
      scripted([`Looking.<|tool_call_start|>[read_file(path='a.txt')]<|tool_call_end|>`]),
    )
    const r = await p.generate(req())
    expect(r.finishReason).toBe('tool-calls')
    expect(calls(r)).toEqual([['read_file', { path: 'a.txt' }]])
    expect(r.message.content[0]).toMatchObject({ type: 'text', text: 'Looking.' })
  })

  it('leaves plain replies and native tool calls alone', async () => {
    const p = textToolCalls(scripted(['just text']))
    expect(await p.generate(req())).toEqual(reply('just text'))

    const native: StepResult = {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '<tool_call>{"name":"x","arguments":{}}</tool_call>' },
          { type: 'tool-call', toolCallId: '1', toolName: 'real', input: {} },
        ],
      },
      finishReason: 'tool-calls',
    }
    const inner: Provider = { id: 'n', generate: async () => native, stream: async function* () {} }
    expect(await textToolCalls(inner).generate(req())).toBe(native)
  })

  it('converts unknown tool names by default, but not with knownToolsOnly', async () => {
    const text = `<|tool_call_start|>[bash(command='ls')]<|tool_call_end|>`
    expect(calls(await textToolCalls(scripted([text])).generate(req()))).toEqual([
      ['bash', { command: 'ls' }],
    ])

    const strict = await textToolCalls(scripted([text]), { knownToolsOnly: true }).generate(req())
    expect(strict.finishReason).toBe('stop')
    expect(strict.message.content).toEqual([{ type: 'text', text }])
  })

  it('streams text live but holds markup back, even when a marker is split across chunks', async () => {
    const full = `Let me look. <|tool_call_start|>[read_file(path='a.txt')]<|tool_call_end|>`
    const events: StreamEvent[] = []
    for await (const e of textToolCalls(scripted([full], 3)).stream(req())) events.push(e)

    const streamed = events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : [])).join('')
    expect(streamed).not.toContain('<|')
    expect(streamed.trimEnd()).toBe('Let me look.')
    const call = events.find((e) => e.type === 'tool-call')
    expect(call).toMatchObject({ toolName: 'read_file', input: { path: 'a.txt' } })
    const finish = events.at(-1)
    expect(finish?.type).toBe('finish')
    // The streamed tool-call and the finished message agree on the id.
    if (finish?.type === 'finish' && call?.type === 'tool-call') {
      expect(finish.result.message.content.filter(isToolCallPart)[0]?.toolCallId).toBe(
        call.toolCallId,
      )
      expect(finish.result.finishReason).toBe('tool-calls')
    }
  })

  it('does not swallow text that merely resembles a marker prefix', async () => {
    const events: StreamEvent[] = []
    for await (const e of textToolCalls(scripted(['a <| b <tool x'], 2)).stream(req()))
      events.push(e)
    expect(events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : [])).join('')).toBe(
      'a <| b <tool x',
    )
  })

  it('drives the agent loop end to end', async () => {
    const seen: unknown[] = []
    const tool = defineTool({
      name: 'read_file',
      description: 'read',
      input: { '~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) } },
      execute: async (input: unknown) => {
        seen.push(input)
        return 'contents'
      },
    })
    const ai = new Intelligence({
      provider: textToolCalls(
        scripted([
          `<|tool_call_start|>[read_file(path='a.txt')]<|tool_call_end|>`,
          'It says contents.',
        ]),
      ),
      model: 'm',
      tools: [tool],
    })
    const r = await ai.ask('what is in a.txt?')
    expect(seen).toEqual([{ path: 'a.txt' }])
    expect(r.text).toBe('It says contents.')
    expect(r.steps).toBe(2)
  })
})
