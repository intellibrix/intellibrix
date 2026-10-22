import type { Brick, ToolDefinition } from 'intellibrix'

/**
 * Options for {@link asTool}.
 */
export type AsToolOptions = {
  name?: string
  description?: string
}

/**
 * Wraps a whole `Brick` as one opaque {@link ToolDefinition}: `execute` calls
 * `brick.ask(input.prompt)`. Additive to `brick.tools()`, which exposes
 * individual programs. This is for delegating an entire sub-brick as a
 * single "ask it something" tool, the default granularity `supervisor()`
 * uses for each sub-brick.
 */
export function asTool(brick: Brick, opts: AsToolOptions = {}): ToolDefinition<{ prompt: string }> {
  return {
    name: opts.name ?? brick.name,
    description: opts.description ?? `Delegate a task to the "${brick.name}" brick`,
    input: {
      '~standard': {
        version: 1,
        vendor: 'intellibrix',
        validate: (value: unknown) => {
          if (
            value &&
            typeof value === 'object' &&
            'prompt' in value &&
            typeof (value as { prompt: unknown }).prompt === 'string'
          )
            return { value: value as { prompt: string } }
          return { issues: [{ message: 'Expected { prompt: string }' }] }
        },
      },
    },
    execute: async (input) => {
      const result = await brick.ask(input.prompt)
      return result.text
    },
  }
}
