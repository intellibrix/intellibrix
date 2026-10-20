import { randomUUID } from 'node:crypto'
import { isTextPart, isToolCallPart, type Message, type Part } from './messages.js'
import type { Provider, StreamEvent } from './provider.js'

/**
 * A tool call recovered from model-generated text.
 */
export type ParsedToolCall = {
  toolName: string
  input: unknown
}

/**
 * Recognizes one text-based tool-call format that some models emit in place of
 * native tool calls.
 */
export interface TextToolCallParser {
  name: string
  /** Literal strings that begin a tool call. Used to hold markup back while streaming. */
  markers: string[]
  /**
   * Extracts every tool call from `text`, returning them with the text that
   * remains. A block that can't be parsed, or that contains a call `accept`
   * rejects, must be left in `text` untouched.
   */
  parse(
    text: string,
    accept?: (toolName: string) => boolean,
  ): { calls: ParsedToolCall[]; text: string }
}

export type TextToolCallsOptions = {
  /** Formats to recognize. @default [pythonicToolCalls, hermesToolCalls, xmlToolCalls, invokeToolCalls] */
  parsers?: TextToolCallParser[]
  /**
   * Only convert calls to tools offered in the request, leaving text that names
   * anything else untouched. By default unknown names become calls too, so the
   * agent loop reports `Unknown tool` back to the model and it can self-correct.
   * @default false
   */
  knownToolsOnly?: boolean
}

// ---------------------------------------------------------------------------
// Pythonic format: <|tool_call_start|>[name(arg='value', n=1), other()]<|tool_call_end|>
// ---------------------------------------------------------------------------

class PythonLiteralParser {
  private pos = 0
  constructor(private readonly src: string) {}

  /** Parses `[call(...), call(...)]`, or a single bare call, and requires all input be consumed. */
  parseCalls(): ParsedToolCall[] {
    this.skipSpace()
    const calls: ParsedToolCall[] = []
    if (this.peek() === '[') {
      this.pos++
      this.skipSpace()
      while (this.peek() !== ']') {
        calls.push(this.parseCall())
        this.skipSpace()
        if (this.peek() === ',') {
          this.pos++
          this.skipSpace()
        } else if (this.peek() !== ']') this.fail()
      }
      this.pos++
    } else {
      calls.push(this.parseCall())
    }
    this.skipSpace()
    if (this.pos !== this.src.length) this.fail()
    return calls
  }

  private fail(): never {
    throw new SyntaxError(`Unexpected input at ${this.pos}`)
  }

  private peek(): string | undefined {
    return this.src[this.pos]
  }

  private skipSpace() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++
  }

  private expect(ch: string) {
    if (this.peek() !== ch) this.fail()
    this.pos++
  }

  private identifier(): string {
    const m = /^[A-Za-z_][\w.-]*/.exec(this.src.slice(this.pos))
    if (!m) this.fail()
    this.pos += m[0].length
    return m[0]
  }

  private parseCall(): ParsedToolCall {
    const toolName = this.identifier()
    this.skipSpace()
    this.expect('(')
    const input: Record<string, unknown> = {}
    this.skipSpace()
    while (this.peek() !== ')') {
      const key = this.identifier()
      this.skipSpace()
      this.expect('=')
      this.skipSpace()
      input[key] = this.parseValue()
      this.skipSpace()
      if (this.peek() === ',') {
        this.pos++
        this.skipSpace()
      } else if (this.peek() !== ')') this.fail()
    }
    this.pos++
    return { toolName, input }
  }

  private parseValue(): unknown {
    const ch = this.peek()
    if (ch === "'" || ch === '"') return this.parseString()
    if (ch === '[' || ch === '(') return this.parseSequence(ch === '[' ? ']' : ')')
    if (ch === '{') return this.parseDict()
    const m = /^-?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/.exec(this.src.slice(this.pos))
    if (m) {
      this.pos += m[0].length
      return Number(m[0])
    }
    const word = this.identifier()
    if (word === 'True' || word === 'true') return true
    if (word === 'False' || word === 'false') return false
    if (word === 'None' || word === 'null') return null
    return this.fail()
  }

  private parseString(): string {
    const quote = this.src[this.pos++] as string
    let out = ''
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos++] as string
      if (ch === quote) return out
      if (ch !== '\\') {
        out += ch
        continue
      }
      const esc = this.src[this.pos++]
      switch (esc) {
        case 'n':
          out += '\n'
          break
        case 't':
          out += '\t'
          break
        case 'r':
          out += '\r'
          break
        case 'u': {
          const hex = this.src.slice(this.pos, this.pos + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail()
          out += String.fromCharCode(Number.parseInt(hex, 16))
          this.pos += 4
          break
        }
        case undefined:
          return this.fail()
        default:
          out += esc
      }
    }
    return this.fail()
  }

  private parseSequence(close: string): unknown[] {
    this.pos++
    const out: unknown[] = []
    this.skipSpace()
    while (this.peek() !== close) {
      out.push(this.parseValue())
      this.skipSpace()
      if (this.peek() === ',') {
        this.pos++
        this.skipSpace()
      } else if (this.peek() !== close) this.fail()
    }
    this.pos++
    return out
  }

  private parseDict(): Record<string, unknown> {
    this.pos++
    const out: Record<string, unknown> = {}
    this.skipSpace()
    while (this.peek() !== '}') {
      const key = this.parseValue()
      if (typeof key !== 'string') this.fail()
      this.skipSpace()
      this.expect(':')
      this.skipSpace()
      out[key] = this.parseValue()
      this.skipSpace()
      if (this.peek() === ',') {
        this.pos++
        this.skipSpace()
      } else if (this.peek() !== '}') this.fail()
    }
    this.pos++
    return out
  }
}

/**
 * Pythonic calls wrapped in special tokens, as emitted by e.g. Liquid's LFM
 * models: `<|tool_call_start|>[read_file(path='a.txt')]<|tool_call_end|>`.
 */
export const pythonicToolCalls: TextToolCallParser = {
  name: 'pythonic',
  markers: ['<|tool_call_start|>'],
  parse(text, accept) {
    const calls: ParsedToolCall[] = []
    const remaining = text.replace(
      /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g,
      (block, body: string) => {
        try {
          const parsed = new PythonLiteralParser(body).parseCalls()
          if (accept && !parsed.every((c) => accept(c.toolName))) return block
          calls.push(...parsed)
          return ''
        } catch {
          return block
        }
      },
    )
    return { calls, text: remaining }
  },
}

// ---------------------------------------------------------------------------
// Hermes format (Qwen, Hermes, many others): <tool_call>{"name": "...", "arguments": {...}}</tool_call>
// ---------------------------------------------------------------------------

/**
 * JSON calls in `<tool_call>` tags, as emitted by Hermes, Qwen and many other
 * open models: `<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>`.
 */
export const hermesToolCalls: TextToolCallParser = {
  name: 'hermes',
  markers: ['<tool_call>'],
  parse(text, accept) {
    const calls: ParsedToolCall[] = []
    const remaining = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (block, body: string) => {
      try {
        const parsed = JSON.parse(body.trim()) as {
          name?: unknown
          arguments?: unknown
          parameters?: unknown
        }
        if (typeof parsed.name !== 'string' || (accept && !accept(parsed.name))) return block
        let input = parsed.arguments ?? parsed.parameters ?? {}
        if (typeof input === 'string') input = JSON.parse(input)
        calls.push({ toolName: parsed.name, input })
        return ''
      } catch {
        return block
      }
    })
    return { calls, text: remaining }
  },
}

// ---------------------------------------------------------------------------
// XML format (Qwen3-Coder and others): <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
// ---------------------------------------------------------------------------

/** Values are text; only unambiguous JSON (objects, arrays, booleans, null) is decoded. */
function xmlParameterValue(raw: string): unknown {
  const value = raw.replace(/^\n/, '').replace(/\n$/, '')
  const trimmed = value.trim()
  if (/^(?:[[{]|true$|false$|null$)/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // not JSON after all; keep the text
    }
  }
  return value
}

/**
 * Function/parameter tags inside `<tool_call>`, as emitted by Qwen3-Coder and
 * similar models:
 * `<tool_call><function=read_file><parameter=path>a.txt</parameter></function></tool_call>`.
 * Parameter values stay strings unless they are JSON objects, arrays, booleans or null.
 */
export const xmlToolCalls: TextToolCallParser = {
  name: 'xml',
  markers: ['<tool_call>', '<function='],
  parse(text, accept) {
    const calls: ParsedToolCall[] = []
    const block =
      /(?:<tool_call>\s*)?<function=([^>\s]+)>([\s\S]*?)<\/function>(?:\s*<\/tool_call>)?/g
    const remaining = text.replace(block, (whole, toolName: string, body: string) => {
      if (accept && !accept(toolName)) return whole
      const input: Record<string, unknown> = {}
      const param = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g
      let consumed = body
      for (const m of body.matchAll(param)) {
        input[m[1] as string] = xmlParameterValue(m[2] as string)
        consumed = consumed.replace(m[0], '')
      }
      if (consumed.trim()) return whole
      calls.push({ toolName, input })
      return ''
    })
    return { calls, text: remaining }
  },
}

// ---------------------------------------------------------------------------
// Invoke format: <function_calls><invoke name="tool"><parameter name="key">value</parameter></invoke></function_calls>
// ---------------------------------------------------------------------------

/**
 * `<invoke name="…">` blocks with `<parameter name="…">` children, optionally
 * inside a wrapper tag such as `<function_calls>` or `<dots_function_call>`:
 * `<invoke name="read_file"><parameter name="path">a.txt</parameter></invoke>`.
 * Parameter values are decoded like {@link xmlToolCalls}.
 */
export const invokeToolCalls: TextToolCallParser = {
  name: 'invoke',
  markers: ['<invoke ', '<function_calls>', '<dots_function_call>'],
  parse(text, accept) {
    const calls: ParsedToolCall[] = []
    const run =
      /(?:<(\w*(?:function_calls?|tool_calls?|tool_use)\w*)>\s*)?((?:<invoke\s+name="[^"]*"\s*>[\s\S]*?<\/invoke>\s*)+)(?:<\/\1>)?/g
    const remaining = text.replace(run, (whole, _wrapper: string | undefined, invokes: string) => {
      const found: ParsedToolCall[] = []
      for (const m of invokes.matchAll(/<invoke\s+name="([^"]*)"\s*>([\s\S]*?)<\/invoke>/g)) {
        const toolName = m[1] as string
        if (accept && !accept(toolName)) return whole
        const input: Record<string, unknown> = {}
        let consumed = m[2] as string
        for (const p of (m[2] as string).matchAll(
          /<parameter\s+name="([^"]*)"\s*>([\s\S]*?)<\/parameter>/g,
        )) {
          input[p[1] as string] = xmlParameterValue(p[2] as string)
          consumed = consumed.replace(p[0], '')
        }
        if (consumed.trim()) return whole
        found.push({ toolName, input })
      }
      calls.push(...found)
      return ''
    })
    return { calls, text: remaining }
  },
}

// ---------------------------------------------------------------------------
// Bare JSON: {"tool": "name", "args": {...}}
// ---------------------------------------------------------------------------

const JSON_NAME_KEYS = ['name', 'tool', 'tool_name', 'function']
const JSON_INPUT_KEYS = ['arguments', 'args', 'parameters', 'input']

function jsonCall(value: unknown): ParsedToolCall | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const nameKey = JSON_NAME_KEYS.find((k) => typeof record[k] === 'string')
  if (!nameKey) return undefined
  const inputKey = JSON_INPUT_KEYS.find((k) => k in record)
  let input = inputKey ? record[inputKey] : {}
  if (typeof input === 'string') input = JSON.parse(input)
  return { toolName: record[nameKey] as string, input }
}

/**
 * A reply that is nothing but a JSON tool call (optionally in a code fence),
 * e.g. `{"tool": "read_file", "args": {"path": "a.txt"}}`. The name may be under
 * `name`, `tool`, `tool_name` or `function`, and the input under `arguments`,
 * `args`, `parameters` or `input`; a JSON array holds several calls.
 *
 * Not a default parser, because plain JSON is also a legitimate answer. Opt in
 * with `knownToolsOnly: true` so only calls to offered tools are converted:
 * `textToolCalls(p, { parsers: [...defaultToolCallParsers, jsonToolCalls], knownToolsOnly: true })`.
 */
export const jsonToolCalls: TextToolCallParser = {
  name: 'json',
  markers: ['{"tool"', '{"name"', '{"function"', '{"tool_name"', '```json'],
  parse(text, accept) {
    const body = text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '')
    try {
      const parsed: unknown = JSON.parse(body)
      const calls = (Array.isArray(parsed) ? parsed : [parsed]).map(jsonCall)
      const found = calls.filter((c): c is ParsedToolCall => c !== undefined)
      if (!found.length || found.length !== calls.length) return { calls: [], text }
      if (accept && !found.every((c) => accept(c.toolName))) return { calls: [], text }
      return { calls: found, text: '' }
    } catch {
      return { calls: [], text }
    }
  },
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/** The parsers {@link textToolCalls} uses unless `parsers` is given. */
export const defaultToolCallParsers: TextToolCallParser[] = [
  pythonicToolCalls,
  hermesToolCalls,
  xmlToolCalls,
  invokeToolCalls,
]
const DEFAULT_PARSERS = defaultToolCallParsers

type Accept = ((toolName: string) => boolean) | undefined

function applyParsers(text: string, parsers: TextToolCallParser[], accept: Accept) {
  const calls: ParsedToolCall[] = []
  let remaining = text
  for (const parser of parsers) {
    const parsed = parser.parse(remaining, accept)
    remaining = parsed.text
    calls.push(...parsed.calls)
  }
  return { calls, text: remaining }
}

function extract(
  message: Message,
  parsers: TextToolCallParser[],
  accept: Accept,
): Message | undefined {
  if (message.role !== 'assistant' || message.content.some(isToolCallPart)) return undefined

  const parts: Part[] = []
  const calls: Part[] = []
  for (const part of message.content) {
    if (!isTextPart(part)) {
      parts.push(part)
      continue
    }
    const parsed = applyParsers(part.text, parsers, accept)
    for (const call of parsed.calls) {
      calls.push({
        type: 'tool-call',
        toolCallId: randomUUID(),
        toolName: call.toolName,
        input: call.input,
      })
    }
    const text = parsed.calls.length ? parsed.text.trim() : part.text
    if (text) parts.push({ ...part, text })
  }
  if (!calls.length) return undefined
  return { ...message, content: [...parts, ...calls] }
}

/**
 * Wraps a {@link Provider} so models that write tool calls as plain text
 * (instead of using the API's native tool calling) still drive the agent loop.
 *
 * Only a step that returns no native tool calls is inspected; recognized calls
 * are lifted out of the text into real `tool-call` parts and the step's
 * `finishReason` becomes `'tool-calls'`. Everything else (approvals, schema
 * validation, `Unknown tool` errors) then happens in `loop.ts` exactly as for
 * a native call. Still one model step per call.
 *
 * @example
 * const intelligence = new Intelligence({
 *   provider: textToolCalls(compatibleProvider(model, { baseURL, apiKey })),
 *   model,
 * })
 */
export function textToolCalls(inner: Provider, opts: TextToolCallsOptions = {}): Provider {
  const parsers = opts.parsers ?? DEFAULT_PARSERS
  const markers = parsers.flatMap((p) => p.markers)
  const acceptFor = (req: { tools?: { name: string }[] }): Accept => {
    if (!opts.knownToolsOnly) return undefined
    const known = new Set((req.tools ?? []).map((t) => t.name))
    return (name) => known.has(name)
  }

  return {
    id: inner.id,
    async generate(req) {
      const result = await inner.generate(req)
      const message = extract(result.message, parsers, acceptFor(req))
      return message ? { ...result, message, finishReason: 'tool-calls' } : result
    },
    async *stream(req): AsyncIterable<StreamEvent> {
      const accept = acceptFor(req)
      let text = ''
      let emitted = 0
      let sawNativeCall = false

      for await (const event of inner.stream(req)) {
        if (event.type === 'tool-call') sawNativeCall = true
        if (event.type === 'text-delta' && !sawNativeCall) {
          text += event.text
          // Hold back from the first marker, or from a tail that could still become one.
          const starts = markers.map((m) => text.indexOf(m)).filter((i) => i >= 0)
          const safe = starts.length
            ? Math.min(...starts)
            : text.length - partialMarkerLength(text, markers)
          if (safe > emitted) {
            yield { type: 'text-delta', text: text.slice(emitted, safe) }
            emitted = safe
          }
          continue
        }
        if (event.type !== 'finish' || sawNativeCall) {
          yield event
          continue
        }

        const message = extract(event.result.message, parsers, accept)
        // Flush whatever was held back that isn't tool-call markup.
        const tail = message
          ? applyParsers(text, parsers, accept).text.slice(emitted).trimEnd()
          : text.slice(emitted)
        if (tail) yield { type: 'text-delta', text: tail }
        if (!message) {
          yield event
          continue
        }
        for (const call of message.content.filter(isToolCallPart)) {
          yield {
            type: 'tool-call',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          }
        }
        yield { type: 'finish', result: { ...event.result, message, finishReason: 'tool-calls' } }
      }
    },
    embed: inner.embed?.bind(inner),
    image: inner.image?.bind(inner),
  }
}

/** Length of the longest suffix of `text` that is a proper prefix of one of `markers`. */
function partialMarkerLength(text: string, markers: string[]): number {
  let longest = 0
  for (const marker of markers) {
    for (let n = Math.min(marker.length - 1, text.length); n > longest; n--) {
      if (text.endsWith(marker.slice(0, n))) {
        longest = n
        break
      }
    }
  }
  return longest
}
