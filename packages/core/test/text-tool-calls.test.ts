import { describe, expect, it } from 'vitest'
import Intelligence from '../src/intelligence.js'
import { isToolCallPart, textMessage } from '../src/messages.js'
import type { GenerateRequest, Provider, StepResult, StreamEvent } from '../src/provider.js'
import {
  defaultToolCallParsers,
  hermesToolCalls,
  invokeToolCalls,
  jsonToolCalls,
  pythonicToolCalls,
  textToolCalls,
  xmlToolCalls,
} from '../src/text-tool-calls.js'
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

describe('xmlToolCalls', () => {
  it('parses function/parameter tags, with or without the tool_call wrapper', () => {
    const wrapped = xmlToolCalls.parse(
      'ok\n<tool_call>\n<function=shell>\n<parameter=command>\npwd\n</parameter>\n<parameter=args>\n["-L"]\n</parameter>\n</function>\n</tool_call>',
    )
    expect(wrapped.calls).toEqual([{ toolName: 'shell', input: { command: 'pwd', args: ['-L'] } }])
    expect(wrapped.text.trim()).toBe('ok')
    expect(xmlToolCalls.parse('<function=a></function>').calls).toEqual([
      { toolName: 'a', input: {} },
    ])
  })

  it('leaves stray content inside a block untouched', () => {
    const text = '<function=a>oops<parameter=x>1</parameter></function>'
    expect(xmlToolCalls.parse(text)).toEqual({ calls: [], text })
  })

  it('is recognized by default in generate()', async () => {
    const r = await textToolCalls(
      scripted([
        '<tool_call><function=read_file><parameter=path>a.txt</parameter></function></tool_call>',
      ]),
    ).generate(req())
    expect(calls(r)).toEqual([['read_file', { path: 'a.txt' }]])
  })
})

describe('invokeToolCalls', () => {
  it('parses invoke blocks inside any function-call wrapper, or bare', () => {
    const wrapped = invokeToolCalls.parse(
      'hi\n<dots_function_call>\n<invoke name="get_cwd">\n</invoke>\n</dots_function_call>',
    )
    expect(wrapped.calls).toEqual([{ toolName: 'get_cwd', input: {} }])
    expect(wrapped.text.trim()).toBe('hi')
    const bare = invokeToolCalls.parse(
      '<invoke name="a"><parameter name="x">1</parameter></invoke><invoke name="b"></invoke>',
    )
    expect(bare.calls).toEqual([
      { toolName: 'a', input: { x: '1' } },
      { toolName: 'b', input: {} },
    ])
  })

  it('is recognized by default when streaming, holding the markup back', async () => {
    const events: StreamEvent[] = []
    for await (const e of textToolCalls(
      scripted(['<dots_function_call><invoke name="read_file"></invoke></dots_function_call>']),
    ).stream(req()))
      events.push(e)
    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(1)
    expect(events.some((e) => e.type === 'text-delta')).toBe(false)
  })
})

describe('jsonToolCalls', () => {
  it('parses a bare or fenced JSON call under common key names', () => {
    expect(
      jsonToolCalls.parse('{"tool": "write_file", "args": {"path": "t.txt", "content": "x"}}'),
    ).toEqual({
      calls: [{ toolName: 'write_file', input: { path: 't.txt', content: 'x' } }],
      text: '',
    })
    expect(
      jsonToolCalls.parse('```json\n{"name":"a","arguments":"{\\"n\\":1}"}\n```').calls,
    ).toEqual([{ toolName: 'a', input: { n: 1 } }])
  })

  it('leaves ordinary JSON answers and prose alone', () => {
    for (const text of ['{"answer": 42}', 'see {"tool": "a"} here', '[{"tool":"a"}, 3]'])
      expect(jsonToolCalls.parse(text).calls).toEqual([])
  })

  it('is opt-in, and with knownToolsOnly ignores unoffered names', async () => {
    const wrap = (text: string) =>
      textToolCalls(scripted([text]), {
        parsers: [...defaultToolCallParsers, jsonToolCalls],
        knownToolsOnly: true,
      }).generate(req())
    expect(calls(await wrap('{"tool":"read_file","args":{"path":"a"}}'))).toEqual([
      ['read_file', { path: 'a' }],
    ])
    expect(calls(await wrap('{"tool":"nope","args":{}}'))).toEqual([])
    expect(calls(await textToolCalls(scripted(['{"tool":"read_file"}'])).generate(req()))).toEqual(
      [],
    )
  })
})

describe('text tool call scanning', () => {
  it('stays fast on many unclosed openers', () => {
    const start = Date.now()
    for (const parser of [hermesToolCalls, pythonicToolCalls, xmlToolCalls]) {
      parser.parse('<tool_call><|tool_call_start|><function=a>'.repeat(20_000), undefined)
    }
    expect(Date.now() - start).toBeLessThan(3000)
  })

  it('parses an xml call inside a tool_call wrapper and leaves the rest', () => {
    const out = xmlToolCalls.parse(
      'hi <tool_call>\n<function=read_file><parameter=path>a.txt</parameter></function>\n</tool_call> bye',
      undefined,
    )
    expect(out.calls).toEqual([{ toolName: 'read_file', input: { path: 'a.txt' } }])
    expect(out.text).toBe('hi  bye')
  })
})
