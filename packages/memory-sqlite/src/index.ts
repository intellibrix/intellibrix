import { DatabaseSync } from 'node:sqlite'
import type {
  ConversationMemory,
  Message,
  VectorMatch,
  VectorRecord,
  VectorStore,
} from 'intellibrix'

type SQLiteOptions = {
  /** A file path or `':memory:'`. Ignored when `database` is given. Defaults to `':memory:'`. */
  path?: string
  /** An existing connection to share between stores. The store will not close it. */
  database?: DatabaseSync
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function tableIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid table name "${name}"`)
  return name
}

function open(options: SQLiteOptions): { database: DatabaseSync; owned: boolean } {
  if (options.database) return { database: options.database, owned: false }
  return { database: new DatabaseSync(options.path ?? ':memory:'), owned: true }
}

/**
 * Options for creating a {@link SQLiteConversationMemory}.
 */
export type SQLiteConversationMemoryOptions = SQLiteOptions & {
  /** Defaults to `intellibrix_messages`. */
  tableName?: string
}

/**
 * A {@link ConversationMemory} on Node's built-in `node:sqlite`, with no native
 * dependencies. Message content is stored as JSON-serialized `Part[]`.
 */
export class SQLiteConversationMemory implements ConversationMemory {
  #database: DatabaseSync
  #owned: boolean
  #table: string

  constructor(options: SQLiteConversationMemoryOptions = {}) {
    const { database, owned } = open(options)
    this.#database = database
    this.#owned = owned
    this.#table = tableIdentifier(options.tableName ?? 'intellibrix_messages')

    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${this.#table}_thread ON ${this.#table} (thread_id, id);
    `)
  }

  async append(threadId: string, message: Message): Promise<void> {
    this.#database
      .prepare(`INSERT INTO ${this.#table} (thread_id, role, content) VALUES (?, ?, ?)`)
      .run(threadId, message.role, JSON.stringify(message.content))
  }

  async getMessages(threadId: string): Promise<Message[]> {
    const rows = this.#database
      .prepare(`SELECT role, content FROM ${this.#table} WHERE thread_id = ? ORDER BY id`)
      .all(threadId) as Array<{ role: Message['role']; content: string }>

    return rows.map((row) => ({ role: row.role, content: JSON.parse(row.content) }))
  }

  async clear(threadId: string): Promise<void> {
    this.#database.prepare(`DELETE FROM ${this.#table} WHERE thread_id = ?`).run(threadId)
  }

  /** Closes the connection, unless it was passed in via `database`. */
  close(): void {
    if (this.#owned && this.#database.isOpen) this.#database.close()
  }
}

/**
 * Options for creating a {@link SQLiteVectorStore}.
 */
export type SQLiteVectorStoreOptions = SQLiteOptions & {
  /** Defaults to `intellibrix_vectors`. */
  tableName?: string
  /** When set, vectors of any other length are rejected on `upsert` and `query`. */
  dimensions?: number
}

function toBlob(vector: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vector).buffer)
}

function fromBlob(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob)
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4)
}

/**
 * A {@link VectorStore} on `node:sqlite`. `node:sqlite` has no vector extension,
 * so `query()` is a brute-force cosine scan over the whole table. That is fine
 * for small, local datasets (a CLI agent's personal memory); for anything
 * larger use `PgVectorStore` from `@intellibrix/sql`.
 *
 * Vectors are stored as 32-bit floats.
 */
export class SQLiteVectorStore implements VectorStore {
  #database: DatabaseSync
  #owned: boolean
  #table: string
  #dimensions?: number

  constructor(options: SQLiteVectorStoreOptions = {}) {
    const { database, owned } = open(options)
    this.#database = database
    this.#owned = owned
    this.#table = tableIdentifier(options.tableName ?? 'intellibrix_vectors')
    this.#dimensions = options.dimensions

    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        metadata TEXT
      )
    `)
  }

  #assertDimensions(vector: number[], what: string): void {
    if (this.#dimensions !== undefined && vector.length !== this.#dimensions)
      throw new Error(
        `SQLiteVectorStore: ${what} has ${vector.length} dimensions, expected ${this.#dimensions}`,
      )
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.#assertDimensions(record.vector, `vector "${record.id}"`)

    const statement = this.#database.prepare(
      `INSERT INTO ${this.#table} (id, vector, metadata) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET vector = excluded.vector, metadata = excluded.metadata`,
    )

    this.#database.exec('BEGIN')
    try {
      for (const record of records)
        statement.run(
          record.id,
          toBlob(record.vector),
          record.metadata === undefined ? null : JSON.stringify(record.metadata),
        )
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  async query(vector: number[], opts?: { topK?: number }): Promise<VectorMatch[]> {
    this.#assertDimensions(vector, 'query vector')

    const rows = this.#database
      .prepare(`SELECT id, vector, metadata FROM ${this.#table}`)
      .all() as Array<{ id: string; vector: Uint8Array; metadata: string | null }>

    let queryNorm = 0
    for (const value of vector) queryNorm += value * value
    queryNorm = Math.sqrt(queryNorm)

    const matches: VectorMatch[] = rows.map((row) => {
      const stored = fromBlob(row.vector)
      let dot = 0
      let norm = 0
      for (let i = 0; i < stored.length; i++) {
        const value = stored[i] ?? 0
        dot += value * (vector[i] ?? 0)
        norm += value * value
      }
      const denominator = queryNorm * Math.sqrt(norm)

      return {
        id: row.id,
        vector: Array.from(stored),
        ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) }),
        score: denominator === 0 ? 0 : dot / denominator,
      }
    })

    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, opts?.topK ?? 10)
  }

  async delete(ids: string[]): Promise<void> {
    const statement = this.#database.prepare(`DELETE FROM ${this.#table} WHERE id = ?`)
    for (const id of ids) statement.run(id)
  }

  /** Closes the connection, unless it was passed in via `database`. */
  close(): void {
    if (this.#owned && this.#database.isOpen) this.#database.close()
  }
}
