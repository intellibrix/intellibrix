import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

import type { Trust } from './messages.js'

/**
 * Context passed to a {@link ToolDefinition}'s `execute` function.
 */
export type ToolContext = {
  /** The {@link Brick} this tool is executing on behalf of, if any. */
  brick?: unknown
  /** An abort signal the tool implementation should honor for cancellation. */
  signal?: AbortSignal
  /** The id of the agent-loop run this call belongs to. */
  runId: string
  /** The trust level of the input that produced this call, if known. */
  trust?: Trust
}

/**
 * A decision returned by an approval hook. `true`/`false` approve or deny the
 * call outright; `{ edit }` approves the call but substitutes its input first.
 */
export type ApprovalDecision = boolean | { edit: unknown }

/**
 * A typed tool a {@link Provider} can be offered and the agent loop can execute.
 */
export type ToolDefinition<In = any, Out = any> = {
  name: string
  description: string
  /** A Standard Schema (e.g. a Zod 4 schema) describing the tool's input. */
  input: StandardSchemaV1<In>
  /** An optional Standard Schema describing the tool's output. */
  output?: StandardSchemaV1<Out>
  execute: (input: In, ctx: ToolContext) => Promise<Out>
  /**
   * Whether this tool requires approval before executing. May be a static
   * boolean or a predicate evaluated per-call (e.g. keying off `ctx.trust`).
   */
  needsApproval?: boolean | ((input: In, ctx: ToolContext) => boolean | Promise<boolean>)
  /**
   * Trust level stamped onto this tool's result `Part`s. Tools returning
   * content fetched from outside the process (MCP, workspace reads, GitHub)
   * should set `'untrusted'`.
   */
  resultTrust?: Trust
}

/**
 * Returns a tool's input as JSON Schema (draft 2020-12), using the Standard
 * JSON Schema interface when the schema implements it (Zod 4 does), and
 * falling back to a permissive object schema otherwise.
 */
export function toolToJSONSchema(tool: ToolDefinition): Record<string, unknown> {
  const standard = tool.input['~standard'] as Partial<StandardJSONSchemaV1.Props>
  const schema = standard.jsonSchema?.input({ target: 'draft-2020-12' })
  return schema ?? { type: 'object', additionalProperties: true }
}

/**
 * Defines a {@link ToolDefinition}. Purely an identity function with a
 * narrower generic-inference signature than a plain object literal.
 */
export function defineTool<In, Out = any>(def: ToolDefinition<In, Out>): ToolDefinition<In, Out> {
  return def
}

/**
 * Validates `input` against a tool's input schema, throwing a descriptive
 * error if validation fails, synchronously unwrapping an async validator.
 */
export async function validateToolInput<In>(
  tool: ToolDefinition<In, any>,
  input: unknown,
): Promise<In> {
  const result = await tool.input['~standard'].validate(input)
  if (result.issues) {
    const message = result.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid input for tool "${tool.name}": ${message}`)
  }

  return result.value
}

/**
 * Resolves a tool's `needsApproval` (static or predicate) for a given call.
 */
export async function resolveNeedsApproval<In>(
  tool: ToolDefinition<In, any>,
  input: In,
  ctx: ToolContext,
): Promise<boolean> {
  if (typeof tool.needsApproval === 'function') return tool.needsApproval(input, ctx)
  return tool.needsApproval ?? false
}
