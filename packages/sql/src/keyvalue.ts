import type { KeyValueStore } from 'intellibrix'
import { QueryTypes, type Sequelize } from 'sequelize'

/**
 * Options for creating a {@link SQLKeyValueStore}.
 */
export type SQLKeyValueStoreOptions = {
  sequelize: Sequelize
  /** The table used to store key/value pairs. Defaults to `intellibrix_kv`. */
  tableName?: string
}

/**
 * A `KeyValueStore` backed by a SQL table via Sequelize, using a parametrized
 * UPSERT. Values are stored as JSON text.
 */
export class SQLKeyValueStore implements KeyValueStore {
  #sequelize: Sequelize
  #tableName: string
  #ready: Promise<void>

  constructor(options: SQLKeyValueStoreOptions) {
    this.#sequelize = options.sequelize
    this.#tableName = options.tableName ?? 'intellibrix_kv'
    this.#ready = this.#init()
  }

  async #init(): Promise<void> {
    await this.#sequelize.query(
      `CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        "key" VARCHAR(255) PRIMARY KEY,
        "value" TEXT
      )`,
    )
  }

  async get(key: string): Promise<any> {
    await this.#ready
    const rows = await this.#sequelize.query<{ value: string }>(
      `SELECT value FROM ${this.#tableName} WHERE "key" = ?`,
      { replacements: [key], type: QueryTypes.SELECT },
    )
    const row = rows[0]
    if (!row) return undefined
    return JSON.parse(row.value)
  }

  async set(key: string, value: any): Promise<void> {
    await this.#ready
    const serialized = JSON.stringify(value)

    await this.#sequelize.query(
      `INSERT INTO ${this.#tableName} ("key", "value") VALUES (?, ?)
       ON CONFLICT ("key") DO UPDATE SET "value" = excluded.value`,
      { replacements: [key, serialized] },
    )
  }

  async delete(key: string): Promise<boolean> {
    await this.#ready
    const [, affected] = await this.#sequelize.query(
      `DELETE FROM ${this.#tableName} WHERE "key" = ?`,
      {
        replacements: [key],
      },
    )
    return Boolean(affected)
  }

  async dump(): Promise<Record<string, any>> {
    await this.#ready
    const rows = await this.#sequelize.query<{ key: string; value: string }>(
      `SELECT "key", "value" FROM ${this.#tableName}`,
      { type: QueryTypes.SELECT },
    )

    const result: Record<string, any> = {}
    for (const row of rows) result[row.key] = JSON.parse(row.value)
    return result
  }

  async load(data: Record<string, any>): Promise<void> {
    for (const [key, value] of Object.entries(data)) await this.set(key, value)
  }
}
