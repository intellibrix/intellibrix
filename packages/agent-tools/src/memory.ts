import { defineTool, type KeyValueStore, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

const MAX_KEY = 100

type Entry = { value: string; savedAt: string }

export type MemoryToolOptions = {
  /** Where notes are kept. Use a persistent store (`@intellibrix/sql`, a file-backed one) to outlive the process. */
  store: KeyValueStore
  /** Prefix for this agent's keys, so several agents can share one store. @default 'memory' */
  namespace?: string
  /** Most notes kept at once; saving past this is refused until something is deleted. @default 500 */
  maxEntries?: number
  /** Longest note, in characters. @default 2000 */
  maxValueChars?: number
  /** Ask a human before saving or deleting a note. @default false */
  approveChanges?: boolean
  /** Most results `search` and `list` return. @default 10 */
  limit?: number
}

/**
 * A `memory` tool: the model saves short notes under a key and finds them again later, even in a
 * new run, because they live in a `KeyValueStore` you choose. Actions: `save`, `get`, `search`
 * (keyword match over keys and notes, best first), `list` and `delete`.
 *
 * Notes come back tagged `untrusted`: the model may have written them after reading a web page, and
 * a later run must not treat them as instructions. Set `approveChanges` if a human should vet what
 * gets remembered.
 */
export function memoryTool(options: MemoryToolOptions): ToolDefinition {
  const { store } = options
  const ns = `${options.namespace ?? 'memory'}:`
  const maxEntries = options.maxEntries ?? 500
  const maxValue = options.maxValueChars ?? 2000
  const limit = options.limit ?? 10

  const all = async (): Promise<{ key: string; entry: Entry }[]> => {
    const dump = await store.dump()
    return Object.entries(dump)
      .filter(([k]) => k.startsWith(ns))
      .map(([k, v]) => ({ key: k.slice(ns.length), entry: v as Entry }))
  }
  const cleanKey = (raw: string | undefined): string => {
    const key = raw?.trim() ?? ''
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters
    if (!key || key.length > MAX_KEY || /[\u0000-\u001f]/.test(key)) {
      throw new Error(`A key is required: 1 to ${MAX_KEY} characters, on one line`)
    }
    return key
  }

  return defineTool({
    name: 'memory',
    description:
      'Remember facts across conversations. action "save": store a short note under a key (saving the same key again replaces it). "get": read a note by key. "search": find notes by keywords. "list": the most recent notes. "delete": forget a note. Save durable facts (preferences, decisions, how this project works), not passing details.',
    input: z.object({
      action: z.enum(['save', 'get', 'search', 'list', 'delete']),
      key: z.string().optional(),
      value: z.string().optional(),
      query: z.string().optional(),
    }),
    needsApproval: options.approveChanges
      ? (input) => input.action === 'save' || input.action === 'delete'
      : false,
    resultTrust: 'untrusted',
    execute: async ({ action, key, value, query }) => {
      switch (action) {
        case 'save': {
          const k = cleanKey(key)
          if (!value?.trim()) throw new Error('save needs a value')
          if (value.length > maxValue) {
            throw new Error(
              `That note is ${value.length} characters; the limit is ${maxValue}. Shorten it.`,
            )
          }
          const existing = await store.get(ns + k)
          if (!existing && (await all()).length >= maxEntries) {
            throw new Error(`Memory is full (${maxEntries} notes). Delete one first.`)
          }
          await store.set(ns + k, { value, savedAt: new Date().toISOString() } satisfies Entry)
          return { saved: k, replaced: Boolean(existing) }
        }
        case 'get': {
          const k = cleanKey(key)
          const entry = (await store.get(ns + k)) as Entry | undefined
          return entry ? { key: k, ...entry } : { key: k, found: false }
        }
        case 'delete': {
          const k = cleanKey(key)
          return { key: k, deleted: await store.delete(ns + k) }
        }
        case 'list': {
          const notes = (await all()).sort((a, b) => b.entry.savedAt.localeCompare(a.entry.savedAt))
          return {
            total: notes.length,
            notes: notes.slice(0, limit).map((n) => ({ key: n.key, ...n.entry })),
          }
        }
        case 'search': {
          const terms = (query ?? '')
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(Boolean)
          if (terms.length === 0) throw new Error('search needs a query')
          const scored = (await all())
            .map((n) => {
              const text = `${n.key} ${n.entry.value}`.toLowerCase()
              return { n, score: terms.filter((t) => text.includes(t)).length }
            })
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score || b.n.entry.savedAt.localeCompare(a.n.entry.savedAt))
          return {
            total: scored.length,
            notes: scored.slice(0, limit).map((s) => ({ key: s.n.key, ...s.n.entry })),
          }
        }
      }
    },
  })
}
