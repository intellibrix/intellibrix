import { randomUUID } from 'crypto'
import EventEmitter from 'events'
import pino from 'pino'

import Brick from './brick'

export type StructureOptions = {
  name?: string
  logLevel?: pino.Level
  logJSON?: boolean
  pinoOptions?: pino.LoggerOptions
}

export default class Structure {
  id: string
  log: pino.Logger
  name: string
  #bricks: Brick[]
  events: EventEmitter

  constructor(opts: StructureOptions = {}, bricks: Brick[] = []) {
    this.id = randomUUID()
    this.name = opts.name || this.id
    this.#bricks = bricks
    this.events = new EventEmitter()

    const logger = pino(opts.pinoOptions || {
      transport: opts.logJSON ? undefined : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname'
        }
      }
    })

    this.log = logger.child({ name: `STRUCTURE:${this.name}` })
    this.log.level = opts.logLevel || 'debug'
    this.log.debug('Structure created')
  }

  get bricks() {
    return this.#bricks
  }

  add(brick: Brick) {
    brick.structure = this
    for (const brick of this.#bricks) brick.events.emit('add-brick', brick)
    this.#bricks.push(brick)
    this.events.emit('add', brick)
    this.log.info(`Added Brick: ${brick.name}`)
  }

  remove(brick: Brick) {
    brick.structure = undefined
    for (const brick of this.#bricks) brick.events.emit('remove-brick', brick)
    this.#bricks = this.#bricks.filter((b) => b !== brick)
    this.events.emit('remove', brick)
    this.log.info(`Removed Brick: ${brick.name}`)
  }

  get(id: string) {
    return this.#bricks.find((b) => b.id === id)
  }

  demolish() {
    for (const brick of this.#bricks) {
      brick.events.emit('demolish', this)
      brick.structure = undefined
    }

    this.#bricks = []
    this.log.info('Demolished Structure')
  }
}