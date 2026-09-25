import { Sequelize } from 'sequelize'

/**
 * Represents a SQL interface for a database.
 */
export interface SQLInterface {
  // Connects to the database
  connect: () => Promise<void>
  // Disconnects from the database
  disconnect: () => Promise<void>
  // Executes a query on the database
  query: (query: string, params?: unknown[]) => Promise<any>
}

/**
 * Represents the options for creating a SQLDatabase instance.
 */
export type SQLDatabaseOptions = {
  // The URI for the database
  uri: string
}

/**
 * Represents a SQL-backed Database that may be used by Bricks to manage data.
 *
 * This is a mechanical Phase 1 extraction of the old `service: 'sql'` branch from
 * intellibrix's core `Database` class. It will gain a `KeyValueStore`-conformant
 * interface (`SQLKeyValueStore`) plus a pgvector `VectorStore` in Phase 7.
 */
export default class SQLDatabase {
  // The URI for the database
  #uri: string
  // The Sequelize instance for interacting with the SQL database
  sequelize: Sequelize
  // The interface for interacting with the database
  interface: SQLInterface

  /**
   * Creates a new instance of the SQLDatabase class.
   * @param options The options for creating the SQLDatabase instance.
   */
  constructor(options: SQLDatabaseOptions) {
    this.#uri = options.uri
    this.sequelize = new Sequelize(this.#uri, { logging: false })
    this.interface = {
      connect: async () => this.sequelize.authenticate(),
      disconnect: async () => this.sequelize.close(),
      query: async (query: string, values?: unknown[]) =>
        this.sequelize.query({ query, values: values as any }),
    } as SQLInterface
  }
}
