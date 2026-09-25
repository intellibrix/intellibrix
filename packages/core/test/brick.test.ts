import { describe, expect, it, vi } from 'vitest'
import Brick, { type BrickOptions } from '../src/brick.js'
import Intelligence from '../src/intelligence.js'
import Structure from '../src/structure.js'

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
              method: async ({ x, y }) => x + y,
            },
            {
              name: 'multiply',
              description: 'Multiply a number by a random number between 0 and 1',
              method: async (payload) => payload * Math.random(),
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
              method: async (payload) => payload + Math.floor(Math.random() * (50 - 10 + 1) + 10),
            },
            {
              name: 'floor',
              description: 'Round a number down to the nearest integer',
              method: async (payload) => Math.floor(payload),
            },
          ],
        },
      ],
    })

    const result2 = await brick.run('calculate', { x: 1, y: 2 })
    expect(result2).toBeGreaterThan(0)
  })
})

describe('Custom Intelligence Brick', () => {
  it('should run a custom Intelligence', async () => {
    const intelligence = new Intelligence({
      service: 'custom',
      method: async (payload) => `Hello ${payload.name}`,
    })

    const brick = new Brick({ intelligence })
    const result = await brick.ai?.ask({ name: 'Belisarius Cawl' })
    expect(result).toEqual('Hello Belisarius Cawl')
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

    const brick = new ExtendedBrick()
    const result = await brick.hello('Belisarius Cawl')
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
})

describe('Brick Event Bus', () => {
  it('should publish and subscribe to events', async () => {
    const brick = new Brick()
    const spy = vi.fn()
    brick.events.on('foo', spy)
    brick.events.emit('foo', { bar: 'baz' })
    expect(spy).toHaveBeenCalledWith({ bar: 'baz' })
  })
})

describe('Brick Task Scheduler', () => {
  it('should schedule a task and run it', () =>
    new Promise<void>((done) => {
      const brick = new Brick()

      brick.schedule({
        name: 'Test Task',
        description: 'Test Task Description',
        schedule: new Date(Date.now() + 100),
        start: true,
        method: (brick) => {
          expect(brick).toBeInstanceOf(Brick)
          brick.log.info('Test Task Executed')
          done()
        },
      })
    }))
})
