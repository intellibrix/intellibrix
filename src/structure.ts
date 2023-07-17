import { randomUUID } from 'crypto'
import EventEmitter from 'events'
import pino from 'pino'

import Brick from './brick'

/**
 * Represents the options for creating a Structure instance.
 */
export type StructureOptions = {
  // The name of the structure
  name?: string
  // The log level for the structure
  logLevel?: pino.Level
  // Whether to log in JSON format
  logJSON?: boolean
  // The options for the pino logger
  pinoOptions?: pino.LoggerOptions
}

/**
 * Represents a Structure that can contain multiple {@link Brick}s.
 */
export default class Structure {
  // The ID of the structure
  id: string
  // The logger for the structure
  log: pino.Logger
  // The name of the structure
  name: string
  // The bricks in the structure
  #bricks: Brick[]
  // The event emitter for the structure
  events: EventEmitter

  /**
   * Creates a new instance of the Structure class.
   * @param options The options for creating the Structure instance.
   * @param bricks The initial bricks in the structure.
   */
  constructor(options: StructureOptions = {}, bricks: Brick[] = []) {
    this.id = randomUUID()
    this.name = options.name || this.id
    this.#bricks = bricks
    this.events = new EventEmitter()

    const logger = pino(options.pinoOptions || {
      transport: options.logJSON ? undefined : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname'
        }
      }
    })

    this.log = logger.child({ name: `STRUCTURE:${this.name}` })
    this.log.level = options.logLevel || 'debug'
    this.log.debug('Structure created')
  }

  /**
   * Gets the bricks in the structure.
   */
  get bricks() {
    return this.#bricks
  }

  /**
   * Adds a brick to the structure.
   * @param brick The brick to add.
   */
  add(brick: Brick) {
    if (this.#bricks.find((b) => b.name === brick.name || b.id === brick.id)) throw new Error('Brick already exists in structure')
    brick.structure = this
    for (const brick of this.#bricks) brick.events.emit('add-brick', { brick, structure: this })
    this.#bricks.push(brick)
    this.events.emit('add', { brick, structure: this })
    this.log.debug(`Added Brick: ${brick.name}`)
  }

  /**
   * Removes a brick from the structure.
   * @param brick The brick to remove.
   */
  remove(brick: Brick) {
    if (!this.#bricks.find((b) => b.name === brick.name || b.id === brick.id)) throw new Error('Brick does not exist in structure')
    brick.structure = undefined
    for (const brick of this.#bricks) brick.events.emit('remove-brick', { brick, structure: this })
    this.#bricks = this.#bricks.filter((b) => b !== brick)
    this.events.emit('remove', { brick, structure: this })
    this.log.debug(`Removed Brick: ${brick.name}`)
  }

  /**
   * Gets a brick from the structure by its ID.
   * @param id The ID of the brick.
   */
  get(id: string) {
    return this.#bricks.find((b) => b.id === id)
  }

  /**
   * Removes all bricks from the structure.
   */
  demolish() {
    for (const brick of this.#bricks) {
      brick.events.emit('demolish', this)
      brick.structure = undefined
    }

    this.#bricks = []
    this.events.emit('demolish')
    this.log.debug('Demolished Structure')
  }
}