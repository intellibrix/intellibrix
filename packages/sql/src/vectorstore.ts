import type { VectorMatch, VectorRecord, VectorStore } from 'intellibrix'
import { QueryTypes, type Sequelize } from 'sequelize'

/**
 * Options for creating a {@link PgVectorStore}.
 */
export type PgVectorStoreOptions = {
  /** A Sequelize connection to a Postgres database with the pgvector extension available. */
  sequelize: Sequelize
  /**
   * Length of every vector. Required: pgvector columns are fixed-width, and a
   * mismatch with your embedding model's output is the most common footgun.
   */
  dimensions: number
  /** Defaults to `intellibrix_vectors`. */
  tableName?: string
  /** Build an HNSW cosine index. Defaults to `true`. */
  index?: boolean
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function toLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/**
 * A {@link VectorStore} on Postgres + pgvector. Ranks by cosine similarity
 * (`<=>`), and reports `score` as `1 - cosine distance` so it is comparable
 * with the in-memory and SQLite stores.
 *
 * The table and extension are created on first use.
 */
export class PgVectorStore implements VectorStore {
  #sequelize: Sequelize
  #dimensions: number
  #table: string
  #index: boolean
  #ready?: Promise<void>

  constructor(options: PgVectorStoreOptions) {
    if (options.sequelize.getDialect() !== 'postgres')
      throw new Error(
        `PgVectorStore requires a Postgres connection, got "${options.sequelize.getDialect()}"`,
      )
    if (!Number.isInteger(options.dimensions) || options.dimensions < 1)
      throw new Error('PgVectorStore: dimensions must be a positive integer')

    const table = options.tableName ?? 'intellibrix_vectors'
    if (!IDENTIFIER.test(table)) throw new Error(`Invalid table name "${table}"`)

    this.#sequelize = options.sequelize
    this.#dimensions = options.dimensions
    this.#table = table
    this.#index = options.index ?? true
  }

  #assertVector(vector: number[], what: string): void {
    if (vector.length !== this.#dimensions)
      throw new Error(
        `PgVectorStore: ${what} has ${vector.length} dimensions, expected ${this.#dimensions}. ` +
          'Check that the embedding model matches the store.',
      )
    if (!vector.every(Number.isFinite))
      throw new Error(`PgVectorStore: ${what} contains a non-finite number`)
  }

  #ensure(): Promise<void> {
    this.#ready ??= this.#init().catch((error) => {
      this.#ready = undefined
      throw error
    })
    return this.#ready
  }

  async #init(): Promise<void> {
    await this.#sequelize.query('CREATE EXTENSION IF NOT EXISTS vector')
    await this.#sequelize.query(
      `CREATE TABLE IF NOT EXISTS ${this.#table} (
        id TEXT PRIMARY KEY,
        embedding vector(${this.#dimensions}) NOT NULL,
        metadata JSONB
      )`,
    )
    if (this.#index)
      await this.#sequelize.query(
        `CREATE INDEX IF NOT EXISTS ${this.#table}_embedding_idx
         ON ${this.#table} USING hnsw (embedding vector_cosine_ops)`,
      )
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.#assertVector(record.vector, `vector "${record.id}"`)
    await this.#ensure()

    await this.#sequelize.transaction(async (transaction) => {
      for (const record of records)
        await this.#sequelize.query(
          `INSERT INTO ${this.#table} (id, embedding, metadata)
           VALUES (:id, CAST(:embedding AS vector), CAST(:metadata AS jsonb))
           ON CONFLICT (id) DO UPDATE
           SET embedding = excluded.embedding, metadata = excluded.metadata`,
          {
            transaction,
            replacements: {
              id: record.id,
              embedding: toLiteral(record.vector),
              metadata: record.metadata === undefined ? null : JSON.stringify(record.metadata),
            },
          },
        )
    })
  }

  async query(vector: number[], opts?: { topK?: number }): Promise<VectorMatch[]> {
    this.#assertVector(vector, 'query vector')
    await this.#ensure()

    const rows = await this.#sequelize.query<{
      id: string
      embedding: string
      metadata: Record<string, any> | null
      score: number
    }>(
      `SELECT id, embedding::text AS embedding, metadata,
              1 - (embedding <=> CAST(:query AS vector)) AS score
       FROM ${this.#table}
       ORDER BY embedding <=> CAST(:query AS vector)
       LIMIT :topK`,
      {
        type: QueryTypes.SELECT,
        replacements: { query: toLiteral(vector), topK: opts?.topK ?? 10 },
      },
    )

    return rows.map((row) => ({
      id: row.id,
      vector: JSON.parse(row.embedding) as number[],
      ...(row.metadata === null ? {} : { metadata: row.metadata }),
      score: Number(row.score),
    }))
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.#ensure()
    await this.#sequelize.query(`DELETE FROM ${this.#table} WHERE id IN (:ids)`, {
      replacements: { ids },
    })
  }
}
