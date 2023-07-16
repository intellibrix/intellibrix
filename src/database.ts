import { Sequelize } from 'sequelize'

export type Service = 'memory' | 'sql'

export type DatabaseOptions = {
  service?: Service
  uri?: string
}

export interface KeyValueInterface {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
  delete: (key: string) => Promise<boolean>
  dump: () => Promise<any>
  load: (data: any) => Promise<void>
}

export interface SQLInterface {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  query: (query: string, params?: unknown[]) => Promise<any>
}

export type DatabaseInterface = KeyValueInterface | SQLInterface

export default class Database {
  #uri?: string
  service: Service
  interface?: DatabaseInterface
  sequelize?: Sequelize
  memory: any

  constructor(opts?: DatabaseOptions) {
    this.service = opts?.service || 'memory'
    this.#uri = opts?.uri

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
