import { randomUUID } from 'node:crypto'
import EventEmitter from 'node:events'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { CronJob } from 'cron'
import type { pino } from 'pino'

import { type KeyValueStore, MemoryKeyValueStore } from './database.js'
import type Intelligence from './intelligence.js'
import type { AskOptions, AskResult } from './intelligence.js'
import { getSharedLogger } from './logger.js'
import type Structure from './structure.js'
import type { ToolDefinition } from './tool.js'
import { UsageAccumulator } from './usage.js'

/**
 * A permissive Standard Schema that accepts any value unchanged. Used as the
 * default `input`/`output` for a {@link Program} that declares neither.
 */
const passthroughSchema: StandardSchemaV1<any> = {
  '~standard': { version: 1, vendor: 'intellibrix', validate: (value: unknown) => ({ value }) },
}

/**
 * Represents a program with a name, optional description and a list of steps.
 * To be used in a {@link Brick}.
 */
export type Program = {
  name: string
  description?: string
  steps: Step[]
  /** Optional Standard Schema validating the program's input, used when exposed via {@link Brick.tools}. */
  input?: StandardSchemaV1
  /** Optional Standard Schema validating the program's output. */
  output?: StandardSchemaV1
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
 * Represents a Scheduled Task with a name, optional description, schedule, start flag, optional timezone and a method.
 *
 * Tasks are powered by the [cron](https://www.npmjs.com/package/cron) package.
 *
 * An object of this type can be passed to the {@link Brick.schedule} method.
 */
export type Task = {
  /** The name of the task. */
  name?: string
  /** An optional description of the task. */
  description?: string
  /** The schedule for the task. This can be a cron string or a Date object. */
  schedule: string | Date
  /** A flag indicating whether the task should start immediately. If not set to true, you must call task.cronjob.start() manually */
  start?: boolean
  /** An optional timezone for the task. */
  timezone?: string
  /** The method to be executed when the task is run. */
  method: (brick: Brick) => any
  /** The method to be executed when the task is completed. */
  onComplete?: (brick: Brick) => any
  /** An optional CronJob instance associated with the task. */
  cronjob?: CronJob<() => any, null>
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
   * The key-value store of the Brick instance. Defaults to an in-memory store.
   */
  database?: KeyValueStore
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
   * The key-value store of the Brick instance.
   */
  db: KeyValueStore

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
   * Tool arrays attached via {@link Brick.use}.
   */
  #attachedTools: ToolDefinition[] = []

  /**
   * The parent Structure of the Brick instance, if any.
   */
  structure?: Structure

  /**
   * The event emitter of the Brick instance. This is used to emit events that occur in the Brick, such as the running of a program.
   */
  events: EventEmitter

  /**
   * The scheduled tasks of the Brick instance. This is a private property used to store the scheduled tasks that the Brick can run.
   */
  #tasks: Task[] = []

  /**
   * The interval of the keep alive function of the Brick instance. This is a private property used to store the interval of the keep alive function.
   */
  #keepAliveInterval?: NodeJS.Timeout

  /**
   * Accumulates token usage/cost across every `ask()` call on this Brick.
   * Starts as a `.child()` of `this.ai.usage` when an `Intelligence` is
   * configured (so totals also roll up there), or standalone otherwise.
   * Rebound as a `.child()` of the parent `Structure`'s `usage` when added
   * to one via `Structure.add()`.
   */
  usage: UsageAccumulator

  /**
   * Creates a new Brick instance.
   * @param options The options for creating a Brick.
   */
  constructor(options: BrickOptions = {}) {
    const logger = getSharedLogger(options)

    this.id = options.id ?? randomUUID()
    this.ai = options.intelligence
    this.db = options.database ?? new MemoryKeyValueStore()
    this.name = options.name || this.id
    this.structure = options.structure
    this.log = logger.child({ name: `🧱BRICK:${this.name}` })
    this.log.level = options.logLevel || 'debug'

    this.events = new EventEmitter()
    this.#programs = {}
    this.usage = this.ai ? this.ai.usage.child() : new UsageAccumulator()
    this.log.debug('Brick created')
  }

  /**
   * Toggles the keep alive flag of the Brick instance, which will prevent the Node process from exiting
   *
   * @remarks This is useful if you don't have a server or something else keeping the Node process alive.
   * @param on - A boolean indicating whether to turn the keep alive flag on or off.
   */
  keepAlive(on: boolean) {
    if (this.#keepAliveInterval) clearInterval(this.#keepAliveInterval)
    if (on) this.#keepAliveInterval = setInterval(() => {}, 1 << 30)
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
    let result: any
    const program = this.#programs[name]
    if (!program) throw new Error('Program does not exist')

    if (program.input) {
      const validated = await program.input['~standard'].validate(payload)
      if (validated.issues) {
        const message = validated.issues.map((issue) => issue.message).join('; ')
        throw new Error(`Invalid input for program "${name}": ${message}`)
      }
      payload = validated.value
    }

    this.events.emit('run', { name, payload })
    this.structure?.events.emit('run', { brick: this, name, payload })

    this.log.info(`Running program ${name}`)

    for (const step of program.steps) {
      for (const action of step.actions) {
        result = await action.method(payload, this)
        payload = result
      }
    }

    if (program.output) {
      const validated = await program.output['~standard'].validate(result)
      if (validated.issues) {
        const message = validated.issues.map((issue) => issue.message).join('; ')
        throw new Error(`Invalid output for program "${name}": ${message}`)
      }
      result = validated.value
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

  /**
   * Exposes every registered program as a {@link ToolDefinition}, each
   * `execute` calling `this.run(program.name, input)`.
   */
  tools(): ToolDefinition[] {
    return Object.values(this.#programs).map((program) => ({
      name: program.name,
      description: program.description ?? `Run the "${program.name}" program`,
      input: program.input ?? passthroughSchema,
      output: program.output,
      execute: async (input: any) => this.run(program.name, input),
    }))
  }

  /**
   * Attaches external tool arrays (e.g. MCP-sourced tools) to this Brick,
   * included whenever `ask()` builds its tool list.
   */
  use(...toolsets: ToolDefinition[][]) {
    for (const toolset of toolsets) this.#attachedTools.push(...toolset)
    return this
  }

  /**
   * Runs a prompt through this Brick's `ai`, offering its programs (via
   * {@link Brick.tools}) plus any tools attached via {@link Brick.use}.
   */
  async ask(prompt: string, options: AskOptions = {}): Promise<AskResult> {
    if (!this.ai) throw new Error('Brick has no Intelligence configured')
    const result = await this.ai.ask(prompt, {
      ...options,
      brick: this,
      brickName: options.brickName ?? this.name,
      tools: [...this.tools(), ...this.#attachedTools, ...(options.tools ?? [])],
    })
    this.usage.add(result.usage, this.ai.model)
    return result
  }

  /**
   * Returns a {@link Task} by its name.
   */
  task(name: string) {
    return this.#tasks.find((t) => t.name === name)
  }

  /**
   * Schedules a {@link Task} to run on a given schedule.
   * This is a wrapper around the [cron](https://www.npmjs.com/package/cron) package.
   *
   * @remarks The task will run on the schedule provided, and will run the method provided with the Brick instance as the first argument.
   * @param task - The {@link Task} to schedule.
   * @returns The scheduled task.
   * @throws An error if the task already exists.
   */
  schedule(task: Task) {
    if (!task.name) task.name = randomUUID()
    if (this.#tasks.find((t) => t.name === task.name)) throw new Error('Task already exists')
    task.cronjob = new CronJob(
      task.schedule,
      () => task.method(this),
      () => task.onComplete?.(this) ?? null,
      task.start ?? true,
      task.timezone,
    )
    this.#tasks.push(task)
    this.events.emit('schedule', task)
    this.structure?.events.emit('schedule', { brick: this, task })
    this.log.info(`Task Scheduled: ${task.name}`)
    return task
  }

  /**
   * Unschedules a task by its name.
   *
   * @param name - The name of the task to unschedule.
   * @throws An error if the task does not exist.
   */
  unschedule(name: string) {
    const task = this.#tasks.find((t) => t.name === name)
    if (!task) throw new Error('Task does not exist')
    task.cronjob?.stop()
    this.#tasks = this.#tasks.filter((t) => t.name !== name)
    this.events.emit('unschedule', name)
    this.structure?.events.emit('unschedule', { brick: this, name })
    this.log.info(`Task Unscheduled: ${name}`)
  }
}
