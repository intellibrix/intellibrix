import { Sequelize } from 'sequelize'

/**
 * Represents the type of database service.
 */
export type DatabaseService = 'memory' | 'sql'

/**
 * Represents the options for creating a Database instance.
 */
export type DatabaseOptions = {
  // The type of database service
  service?: DatabaseService
  // The URI for the database
  uri?: string
}

/**
 * Represents a key-value interface for a database.
 */
export interface KeyValueInterface {
  // Gets a value by its key
  get: (key: string) => Promise<any>
  // Sets a value by its key
  set: (key: string, value: any) => Promise<void>
  // Deletes a value by its key
  delete: (key: string) => Promise<boolean>
  // Dumps the entire database
  dump: () => Promise<any>
  // Loads data into the database
  load: (data: any) => Promise<void>
}

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
 * Represents a database interface, which can be either a key-value interface or a SQL interface.
 */
export type DatabaseInterface = KeyValueInterface | SQLInterface

/**
 * Represents a Database that may be used by {@link Brick}s to manage data.
 */
export default class Database {
  // The URI for the database
  #uri?: string
  // The type of database service
  service: DatabaseService
  // The interface for interacting with the database
  interface?: DatabaseInterface
  // The Sequelize instance for interacting with a SQL database
  sequelize?: Sequelize
  // The in-memory database
  memory: any

  /**
   * Creates a new instance of the Database class.
   * @param options The options for creating the Database instance.
   */
  constructor(options?: DatabaseOptions) {
    this.service = options?.service || 'memory'
    this.#uri = options?.uri

    switch (this.service) {
      case 'memory':
        const memoryInterface: KeyValueInterface = {
          get: async (key: string) => this.memory[key],
          set: async (key: string, value: any) => this.memory[key] = value,
          delete: async (key: string) => delete this.memory[key],
          dump: async () => this.memory,
          load: async (data: any) => this.memory = data
        }

        this.memory = {}
        this.interface = memoryInterface
        break
      case 'sql':
        if (!this.#uri) break
        this.sequelize = new Sequelize(this.#uri, { logging: false })
        this.interface = {
          connect: async () => this.sequelize?.authenticate(),
          disconnect: async () => this.sequelize?.close(),
          query: async (query: string, values?: unknown[]) => this.sequelize?.query({ query, values: values as any })
        } as SQLInterface

        break
      default:
        throw new Error('Invalid service')
    }
  }
}
