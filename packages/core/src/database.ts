import type { Message } from './messages.js'

/**
 * A simple, provider-agnostic key-value store.
 */
export interface KeyValueStore {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
  delete(key: string): Promise<boolean>
  dump(): Promise<Record<string, any>>
  load(data: Record<string, any>): Promise<void>
}

/**
 * Persists and retrieves conversation history by thread id.
 */
export interface ConversationMemory {
  append(threadId: string, message: Message): Promise<void>
  getMessages(threadId: string): Promise<Message[]>
  clear(threadId: string): Promise<void>
}

/**
 * A single entry in a {@link VectorStore}.
 */
export type VectorRecord = {
  id: string
  vector: number[]
  metadata?: Record<string, any>
}

/**
 * A vector-similarity search result.
 */
export type VectorMatch = VectorRecord & { score: number }

/**
 * A provider-agnostic vector store for semantic search / retrieval.
 */
export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>
  query(vector: number[], opts?: { topK?: number }): Promise<VectorMatch[]>
  delete(ids: string[]): Promise<void>
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * An in-memory {@link KeyValueStore}. The default store used by a {@link Brick}
 * when no other is configured.
 */
export class MemoryKeyValueStore implements KeyValueStore {
  #data: Record<string, any> = {}

  async get(key: string): Promise<any> {
    return this.#data[key]
  }

  async set(key: string, value: any): Promise<void> {
    this.#data[key] = value
  }

  async delete(key: string): Promise<boolean> {
    return delete this.#data[key]
  }

  async dump(): Promise<Record<string, any>> {
    return this.#data
  }

  async load(data: Record<string, any>): Promise<void> {
    this.#data = data
  }
}

/**
 * An in-memory {@link ConversationMemory}, keyed by thread id.
 */
export class MemoryConversationMemory implements ConversationMemory {
  #threads = new Map<string, Message[]>()

  async append(threadId: string, message: Message): Promise<void> {
    const thread = this.#threads.get(threadId) ?? []
    thread.push(message)
    this.#threads.set(threadId, thread)
  }

  async getMessages(threadId: string): Promise<Message[]> {
    return [...(this.#threads.get(threadId) ?? [])]
  }

  async clear(threadId: string): Promise<void> {
    this.#threads.delete(threadId)
  }
}

/**
 * An in-memory {@link VectorStore} using brute-force cosine similarity.
 * Fine for small datasets; see `@intellibrix/sql`'s `PgVectorStore` or
 * `@intellibrix/memory-sqlite`'s `SQLiteVectorStore` for larger ones.
 */
export class MemoryVectorStore implements VectorStore {
  #records = new Map<string, VectorRecord>()

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.#records.set(record.id, record)
  }

  async query(vector: number[], opts?: { topK?: number }): Promise<VectorMatch[]> {
    const topK = opts?.topK ?? 10
    const matches: VectorMatch[] = [...this.#records.values()].map((record) => ({
      ...record,
      score: cosineSimilarity(vector, record.vector),
    }))

    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, topK)
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.#records.delete(id)
  }
}
