import { describe, expect, it } from 'vitest'
import { runAgentLoop } from '../src/loop.js'
import { textMessage } from '../src/messages.js'
import { fromJSONSchema } from '../src/schema-adapter.js'
import { MockProvider } from '../src/testing.js'
import { defineTool, toolToJSONSchema } from '../src/tool.js'

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
  required: ['name'],
}

describe('fromJSONSchema', () => {
  it('accepts a valid value and returns it unchanged', async () => {
    const result = await fromJSONSchema(schema)['~standard'].validate({ name: 'a', age: 3 })
    expect(result).toEqual({ value: { name: 'a', age: 3 } })
  })

  it('reports issues for an invalid value', async () => {
    const result = await fromJSONSchema(schema)['~standard'].validate({ age: 'x' })
    expect('issues' in result && result.issues?.length).toBeGreaterThan(0)
  })

  it('exposes the source schema through the Standard JSON Schema interface', () => {
    const wrapped = fromJSONSchema(schema)
    expect(wrapped['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toBe(schema)
  })
})

describe('toolToJSONSchema', () => {
  it('returns the backing JSON Schema for a JSON-Schema-sourced tool', () => {
    const tool = defineTool({
      name: 't',
      description: 'd',
      input: fromJSONSchema(schema),
      execute: async () => 'ok',
    })
    expect(toolToJSONSchema(tool)).toBe(schema)
  })

  it('falls back to a permissive object schema when none is available', () => {
    const tool = defineTool({
      name: 't',
      description: 'd',
      input: {
        '~standard': { version: 1, vendor: 'x', validate: (value: unknown) => ({ value }) },
      },
      execute: async () => 'ok',
    })
    expect(toolToJSONSchema(tool)).toEqual({ type: 'object', additionalProperties: true })
  })
})

describe('ToolDefinition.resultTrust', () => {
  it("stamps trust onto the tool-result Part when set to 'untrusted'", async () => {
    const tool = defineTool({
      name: 'fetch',
      description: 'd',
      input: fromJSONSchema({ type: 'object' }),
      resultTrust: 'untrusted',
      execute: async () => 'remote content',
    })

    const result = await runAgentLoop({
      provider: new MockProvider([
        { toolCalls: [{ toolName: 'fetch', input: {} }] },
        { text: 'done' },
      ]),
      model: 'mock',
      messages: [textMessage('user', 'go')],
      tools: [tool],
    })

    const toolMessage = result.messages.find((m) => m.role === 'tool')
    expect(toolMessage?.content[0]).toMatchObject({ type: 'tool-result', trust: 'untrusted' })
  })
})
