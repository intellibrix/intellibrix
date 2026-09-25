/**
 * Represents the type of database service.
 */
export type DatabaseService = 'memory'

/**
 * Represents the options for creating a Database instance.
 */
export type DatabaseOptions = {
  // The type of database service
  service?: DatabaseService
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
 * Represents a database interface.
 */
export type DatabaseInterface = KeyValueInterface

/**
 * Represents a Database that may be used by {@link Brick}s to manage data.
 *
 * SQL support has moved to `@intellibrix/sql`. This class will itself be replaced
 * in Phase 2 by the `KeyValueStore`/`ConversationMemory`/`VectorStore` interfaces.
 */
export default class Database {
  // The type of database service
  service: DatabaseService
  // The interface for interacting with the database
  interface?: DatabaseInterface
  // The in-memory database
  memory: any

  /**
   * Creates a new instance of the Database class.
   * @param options The options for creating the Database instance.
   */
  constructor(options?: DatabaseOptions) {
    this.service = options?.service || 'memory'

    switch (this.service) {
      case 'memory': {
        const memoryInterface: KeyValueInterface = {
          get: async (key: string) => this.memory[key],
          set: async (key: string, value: any) => (this.memory[key] = value),
          delete: async (key: string) => delete this.memory[key],
          dump: async () => this.memory,
          load: async (data: any) => (this.memory = data),
        }

        this.memory = {}
        this.interface = memoryInterface
        break
      }
      default:
        throw new Error('Invalid service')
    }
  }
}
