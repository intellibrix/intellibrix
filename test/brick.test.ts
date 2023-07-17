import Brick, { BrickOptions } from '../src/brick'
import Database, { SQLInterface } from '../src/database'
import Intelligence from '../src/intelligence'
import Structure from '../src/structure'

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
          method: async (payload: any) => payload
        },

        {
          name: 'Action 2',
          description: 'This is the second action',
          method: async (payload: any) => {
            payload.bar = 'baz'
            return payload
          }
        }
      ]
    }
  ]
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
              method: async function ({ x, y }) {
                return x + y
              }
            },
            {
              name: 'multiply',
              description: 'Multiply a number by a random number between 0 and 1',
              method: async function (payload) {
                return payload * Math.random()
              }
            }
          ]
        },
        {
          name: 'Step 2',
          description: 'Add a random integer between 10 and 50 to the result and return the floor',
          actions: [
            {
              name: 'add_one',
              description: 'Add a random integer between 10 and 50 to the result',
              method: async function (payload) {
                return payload + Math.floor(Math.random() * (50 - 10 + 1) + 10)
              }
            },
            {
              name: 'floor',
              description: 'Round a number down to the nearest integer',
              method: async function (payload) {
                return Math.floor(payload)
              }
            }
          ]
        }
      ]
    })

    const result2 = await brick.run('calculate', { x: 1, y: 2 })
    expect(result2).toBeGreaterThan(0)
  })
})

describe('Custom Intelligence Brick', () => {
  it('should run a custom Intelligence', async () => {
    const intelligence = new Intelligence({
      service: 'custom',
      method: async function (payload) {
        return `Hello ${payload.name}`
      }
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

describe('Database Brick', () => {
  it('should create a table, insert data, read data, update data, and delete data', async () => {
    const brick = new Brick({ database: new Database({ service: 'sql', uri: 'sqlite::memory:' }) })
    const db = brick.db!.interface as SQLInterface

    await db.query('CREATE TABLE IF NOT EXISTS brixtest (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
    await db.query('INSERT INTO brixtest (name, age) VALUES (?, ?)', ['Belisarius Cawl', 10000])
    const [results] = await db.query('SELECT * FROM brixtest')
    expect(results).toEqual([{ id: 1, name: 'Belisarius Cawl', age: 10000 }])
  })
})

describe('Structure Event Bus', () => {
  it('should publish and subscribe to events', async () => {
    const structure = new Structure()
    const spy = jest.fn()
    structure.events.on('foo', spy)
    structure.events.emit('foo', { bar: 'baz' })
    expect(spy).toHaveBeenCalledWith({ bar: 'baz' })
  })
})

describe('Brick Event Bus', () => {
  it('should publish and subscribe to events', async () => {
    const brick = new Brick()
    const spy = jest.fn()
    brick.events.on('foo', spy)
    brick.events.emit('foo', { bar: 'baz' })
    expect(spy).toHaveBeenCalledWith({ bar: 'baz' })
  })
})
