import { randomUUID } from 'crypto'
import EventEmitter from 'events'
import pino from 'pino'

import Database from './database'
import Intelligence from './intelligence'
import Structure from './structure'

export type Program = {
  name: string
  description?: string
  steps: Step[]
}

export type Step = {
  name?: string
  description?: string
  actions: Action[]
}

export type Action = {
  name?: string
  description?: string
  method: (payload: any, brick: Brick) => Promise<any>
}

export type BrickOptions = {
  id?: string
  name?: string
  logLevel?: pino.Level
  logJSON?: boolean
  pinoOptions?: pino.LoggerOptions
  structure?: Structure
  intelligence?: Intelligence
  database?: Database
}

export default class Brick {
  id: string
  ai?: Intelligence
  db?: Database
  log: pino.Logger
  name: string
  #programs: { [key: string]: Program }
  structure?: Structure
  events: EventEmitter

  constructor(opts: BrickOptions = {}) {
    const logger = pino(opts.pinoOptions || {
      transport: opts.logJSON ? undefined : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname'
        }
      }
    })

    this.id = randomUUID()
    this.ai = opts.intelligence
    this.db = opts.database
    this.name = opts.name || this.id
    this.structure = opts.structure
    this.log = logger.child({ name: `BRICK:${this.name}` })
    this.log.level = opts.logLevel || 'debug'

    this.events = new EventEmitter()
    this.#programs = {}
    this.log.debug('Brick created')
  }

  get programs() {
    return this.#programs
  }

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

  program(program: Program) {
    if (!program.name) program.name = randomUUID()
    if (this.#programs[program.name]) throw new Error('Program already exists')
    this.#programs[program.name] = program
    this.events.emit('program', program)
    this.structure?.events.emit('program', { brick: this, program })
    this.log.info(`Program Added: ${program.name}`)
  }

  deprogram(name: string) {
    if (!this.#programs[name]) throw new Error('Program does not exist')
    delete this.#programs[name]
    this.events.emit('deprogram', name)
    this.structure?.events.emit('deprogram', { brick: this, name })
    this.log.info(`Program Removed: ${name}`)
  }
}


