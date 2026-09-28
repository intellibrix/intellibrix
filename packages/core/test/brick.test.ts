import { describe, expect, it, vi } from 'vitest'
import Brick, { type BrickOptions } from '../src/brick.js'
import Intelligence from '../src/intelligence.js'
import { getSharedLogger, resetSharedLogger } from '../src/logger.js'
import Structure from '../src/structure.js'
import { MockProvider, mockTool } from '../src/testing.js'

const brick = new Brick()
const program = {
  name: 'Main Program',
  description: 'This is the main program',
  steps: [
    {
      name: 'Step 1',
      description: 'This is the first step',
      actions: [
        {
          name: 'Action 1',
          description: 'This is the first action',
          method: async (payload: any) => payload,
        },

        {
          name: 'Action 2',
          description: 'This is the second action',
          method: async (payload: any) => {
            payload.bar = 'baz'
            return payload
          },
        },
      ],
    },
  ],
}

brick.program(program)

describe('Dumb Brick', () => {
  it('should run the main program, then add a new program and run it', async () => {
    const result = await brick.run('Main Program', { foo: 'bar' })
    expect(result).toEqual({ foo: 'bar', bar: 'baz' })

    brick.program({
      name: 'calculate',
      description: 'Multi-step calculation',
      steps: [
        {
          name: 'Step 1',
          description: 'Add the numbers, then multiply by a random number between 0 and 1',
          actions: [
            {
              name: 'sum',
              description: 'Add two numbers',
              method: async ({ x, y }: { x: number; y: number }) => x + y,
            },
            {
              name: 'multiply',
              description: 'Multiply a number by a random number between 0 and 1',
              method: async (payload: number) => payload * Math.random(),
            },
          ],
        },
        {
          name: 'Step 2',
          description: 'Add a random integer between 10 and 50 to the result and return the floor',
          actions: [
            {
              name: 'add_one',
              description: 'Add a random integer between 10 and 50 to the result',
              method: async (payload: number) =>
                payload + Math.floor(Math.random() * (50 - 10 + 1) + 10),
            },
            {
              name: 'floor',
              description: 'Round a number down to the nearest integer',
              method: async (payload: number) => Math.floor(payload),
            },
          ],
        },
      ],
    })

    const result2 = await brick.run('calculate', { x: 1, y: 2 })
    expect(result2).toBeGreaterThan(0)
  })
})

describe('Extended Brick', () => {
  it('should run an extended Brick method', async () => {
    class ExtendedBrick extends Brick {
      data: { greeted: string } = { greeted: '' }

      constructor(options?: BrickOptions) {
        super(options)
      }

      async hello(payload: any) {
        return `Hello ${payload}`
      }
    }

    const extended = new ExtendedBrick()
    const result = await extended.hello('Belisarius Cawl')
    expect(result).toEqual('Hello Belisarius Cawl')
  })
})

describe('Structure Event Bus', () => {
  it('should publish and subscribe to events', async () => {
    const structure = new Structure()
    const spy = vi.fn()
    structure.events.on('foo', spy)
    structure.events.emit('foo', { bar: 'baz' })
    expect(spy).toHaveBeenCalledWith({ bar: 'baz' })
  })

  it('should expose a shared KeyValueStore as `state`', async () => {
    const structure = new Structure()
    await structure.state.set('foo', 'bar')
    expect(await structure.state.get('foo')).toEqual('bar')
  })

  it('should sum two Bricks usage into `structure.usage` when added', async () => {
    const structure = new Structure()
    const provider = new MockProvider([{ text: 'reply a' }, { text: 'reply b' }])

    const aiA = new Intelligence({ provider, model: 'mock' })
    const brickA = new Brick({ intelligence: aiA })
    structure.add(brickA)
    await brickA.ask('question a')

    const aiB = new Intelligence({ provider, model: 'mock' })
    const brickB = new Brick({ intelligence: aiB })
    structure.add(brickB)
    await brickB.ask('question b')

    expect(structure.usage.totals.totalTokens).toBe(
      brickA.usage.totals.totalTokens + brickB.usage.totals.totalTokens,
    )
  })
})

describe('Brick Event Bus', () => {
  it('should publish and subscribe to events', async () => {
    const eventBrick = new Brick()
    const spy = vi.fn()
    eventBrick.events.on('foo', spy)
    eventBrick.events.emit('foo', { bar: 'baz' })
    expect(spy).toHaveBeenCalledWith({ bar: 'baz' })
  })
})

describe('Brick Task Scheduler', () => {
  it('should schedule a task and run it', () =>
    new Promise<void>((done) => {
      const taskBrick = new Brick()

      taskBrick.schedule({
        name: 'Test Task',
        description: 'Test Task Description',
        schedule: new Date(Date.now() + 100),
        start: true,
        method: (b) => {
          expect(b).toBeInstanceOf(Brick)
          b.log.info('Test Task Executed')
          done()
        },
      })
    }))

  it('should honor `start: false` and leave the cronjob stopped (bug fix regression)', async () => {
    const taskBrick = new Brick()
    const method = vi.fn()

    const task = taskBrick.schedule({
      name: 'Stopped Task',
      schedule: new Date(Date.now() + 50),
      start: false,
      method,
    })

    expect(task.cronjob?.isActive).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(method).not.toHaveBeenCalled()
  })

  it('should not invoke onComplete eagerly at schedule-time (bug fix regression)', () => {
    const taskBrick = new Brick()
    const onComplete = vi.fn()

    taskBrick.schedule({
      name: 'OnComplete Task',
      schedule: new Date(Date.now() + 10000),
      start: false,
      method: () => {},
      onComplete,
    })

    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('Brick id (bug fix regression)', () => {
  it('should honor a provided id instead of always generating a random one', () => {
    const idBrick = new Brick({ id: 'my-fixed-id' })
    expect(idBrick.id).toEqual('my-fixed-id')
  })

  it('should generate a random id when none is provided', () => {
    const a = new Brick()
    const b = new Brick()
    expect(a.id).not.toEqual(b.id)
  })
})

describe('Shared logger (bug fix regression)', () => {
  it('should return the same pino instance across multiple Brick/Structure instances', () => {
    resetSharedLogger()
    const logger1 = getSharedLogger({ logJSON: true })
    new Brick({ logJSON: true })
    new Structure({ logJSON: true })
    const logger2 = getSharedLogger({ logJSON: true })
    expect(logger1).toBe(logger2)
  })
})

describe('Brick.tools / Brick.use / Brick.ask', () => {
  it('should expose registered programs as tools and wire them into ask()', async () => {
    const toolBrick = new Brick()
    toolBrick.program({
      name: 'greet',
      description: 'Greets someone',
      steps: [
        { actions: [{ method: async (payload: { name: string }) => `Hello ${payload.name}` }] },
      ],
    })

    const brickTools = toolBrick.tools()
    expect(brickTools.map((t) => t.name)).toContain('greet')

    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'greet', input: { name: 'Belisarius Cawl' } }] },
      { text: 'Greeted successfully' },
    ])

    toolBrick.ai = new Intelligence({ provider, model: 'mock' })
    const result = await toolBrick.ask('Please greet Belisarius Cawl')
    expect(result.text).toEqual('Greeted successfully')
  })

  it('should include tools attached via use()', async () => {
    const useBrick = new Brick()
    const extra = mockTool('extra_tool', async () => 'extra result')
    useBrick.use([extra])

    const provider = new MockProvider([
      { toolCalls: [{ toolName: 'extra_tool', input: {} }] },
      { text: 'done' },
    ])

    useBrick.ai = new Intelligence({ provider, model: 'mock' })
    const result = await useBrick.ask('go')
    expect(result.text).toEqual('done')
  })

  it('should throw when ask() is called without an Intelligence configured', async () => {
    const bareBrick = new Brick()
    await expect(bareBrick.ask('hi')).rejects.toThrow('no Intelligence configured')
  })
})
