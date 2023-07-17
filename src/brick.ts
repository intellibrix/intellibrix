import { randomUUID } from 'crypto'
import EventEmitter from 'events'
import pino from 'pino'

import Database from './database'
import Intelligence from './intelligence'
import Structure from './structure'

/**
 * Represents a program with a name, optional description and a list of steps.
 * To be used in a {@link Brick}.
 */
export type Program = {
  name: string
  description?: string
  steps: Step[]
}

/**
 * Represents a step in a program with an optional name, description and a list of actions.
 * To be used in a {@link Program}.
 */
export type Step = {
  name?: string
  description?: string
  actions: Action[]
}

/**
 * Represents an action in a step with an optional name, description and a method.
 * To be used in a {@link Step} of a {@link Program}.
 */
export type Action = {
  name?: string
  description?: string
  method: (payload: any, brick: Brick) => Promise<any>
}

/**
 * Represents the options for creating a Brick instance.
 */
export type BrickOptions = {
  /**
   * The unique identifier of the Brick instance. If not provided, a random UUID will be generated.
   */
  id?: string

  /**
   * The name of the Brick instance. If not provided, the id will be used as the name.
   */
  name?: string

  /**
   * The log level of the Brick instance. This determines the level of detail of the logs.
   */
  logLevel?: pino.Level

  /**
   * A boolean indicating whether the logs should be in JSON format.
   */
  logJSON?: boolean

  /**
   * The options for the pino logger used by the Brick instance.
   */
  pinoOptions?: pino.LoggerOptions

  /**
   * The parent Structure of the Brick, if any.
   */
  structure?: Structure

  /**
   * The Intelligence of the Brick instance. This is used to manage the AI capabilities of the Brick.
   */
  intelligence?: Intelligence

  /**
   * The database of the Brick instance. This is used to manage the data storage and retrieval for the Brick.
   */
  database?: Database
}

/**
 * A Brick is the core of the framework. It encapsulates various functionality such as AI, data storage and retrieval, processing, and logging.
 * Many Bricks can be combined to form a {@link Structure}, which may be easily passed around your application.
 */
export default class Brick {
  /**
   * The unique identifier of the Brick instance.
   */
  id: string

  /**
   * The intelligence of the Brick instance. This is used to manage the AI capabilities of the Brick.
   */
  ai?: Intelligence

  /**
   * The database of the Brick instance. This is used to manage the data storage and retrieval for the Brick.
   */
  db?: Database

  /**
   * The logger used by the Brick instance. This is used to log information about the operation of the Brick.
   */
  log: pino.Logger

  /**
   * The name of the Brick instance.
   */
  name: string

  /**
   * The programs of the Brick instance. This is a private property used to store the programs that the Brick can run.
   */
  #programs: { [key: string]: Program }

  /**
   * The parent Structure of the Brick instance, if any.
   */
  structure?: Structure

  /**
   * The event emitter of the Brick instance. This is used to emit events that occur in the Brick, such as the running of a program.
   */
  events: EventEmitter

  /**
   * Creates a new Brick instance.
   * @param {Object} options - The options for creating a Brick.
   * @param {string} options.id - The unique identifier of the Brick instance. If not provided, a random UUID will be generated.
   * @param options.name - The name of the Brick instance. If not provided, the id will be used as the name.
   * @param options.logLevel - The log level of the Brick instance.
   * @param options.logJSON - A boolean indicating whether the logs should be in JSON format.
   * @param options.pinoOptions - The options for the pino logger used by the Brick instance.
   * @param options.structure - The parent Structure of the Brick, if any.
   * @param options.intelligence - The Intelligence of the Brick instance. This is used to manage the AI capabilities of the Brick.
   * @param options.database - The database of the Brick instance. This is used to manage the data storage and retrieval for the Brick.
   */
  constructor(options: BrickOptions = {}) {
    const logger = pino(options.pinoOptions || {
      transport: options.logJSON ? undefined : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname'
        }
      }
    })

    this.id = randomUUID()
    this.ai = options.intelligence
    this.db = options.database
    this.name = options.name || this.id
    this.structure = options.structure
    this.log = logger.child({ name: `BRICK:${this.name}` })
    this.log.level = options.logLevel || 'debug'

    this.events = new EventEmitter()
    this.#programs = {}
    this.log.debug('Brick created')
  }

  /**
   * Returns the private map of programs.
   */
  get programs() {
    return this.#programs
  }

  /**
   * Runs a program by its name with a given payload.
   * @param name - The name of the program to run.
   * @param payload - The payload to pass to the program.
   * @returns The result of the program.
   */
  async run(name: string, payload: any) {
    let result
    const program = this.#programs[name]
    if (!program) throw new Error('Program does not exist')
    this.events.emit('run', { name, payload })
    this.structure?.events.emit('run', { brick: this, name, payload })

    this.log.info(`Running program ${name}`)

    for (const step of program.steps) {
      for (const action of step.actions) {
        result = await action.method(payload, this)
        payload = result
      }
    }

    return result
  }

  /**
   * Adds a program to the private map of programs.
   * @param program - The program to add.
   */
  program(program: Program) {
    if (!program.name) program.name = randomUUID()
    if (this.#programs[program.name]) throw new Error('Program already exists')
    this.#programs[program.name] = program
    this.events.emit('program', program)
    this.structure?.events.emit('program', { brick: this, program })
    this.log.info(`Program Added: ${program.name}`)
  }

  /**
   * Removes a program from the private map of programs by its name.
   * @param name - The name of the program to remove.
   */

  deprogram(name: string) {
    if (!this.#programs[name]) throw new Error('Program does not exist')
    delete this.#programs[name]
    this.events.emit('deprogram', name)
    this.structure?.events.emit('deprogram', { brick: this, name })
    this.log.info(`Program Removed: ${name}`)
  }
}


