import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { Ajv } from 'ajv'

/**
 * A raw JSON Schema object, e.g. as advertised by an MCP server's tool.
 */
export type JSONSchema = Record<string, unknown>

/**
 * A Standard Schema that also exposes its source JSON Schema via the Standard
 * JSON Schema interface, so it round-trips through `toolToJSONSchema()`.
 */
export type JSONSchemaBackedSchema<T = unknown> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>

const ajv = new Ajv({ strict: false, allErrors: true })

/**
 * Wraps a raw JSON Schema as a Standard Schema, validated at runtime with Ajv.
 * Lets tools sourced from JSON Schema (e.g. MCP) sit behind the same
 * `~standard` interface as Zod-based tools, so `loop.ts` stays unaware of the
 * distinction.
 */
export function fromJSONSchema<T = unknown>(schema: JSONSchema): JSONSchemaBackedSchema<T> {
  const { $schema: _ignored, ...compilable } = schema
  const validateFn = ajv.compile(compilable)

  return {
    '~standard': {
      version: 1,
      vendor: 'intellibrix-json-schema',
      validate: (value: unknown) => {
        if (validateFn(value)) return { value: value as T }
        return {
          issues: (validateFn.errors ?? []).map((error) => ({
            message: `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`.trim(),
          })),
        }
      },
      jsonSchema: {
        input: () => schema,
        output: () => schema,
      },
    },
  }
}
