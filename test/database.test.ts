import Brick from '../src/brick'
import Database, { KeyValueInterface, SQLInterface } from '../src/database'

describe('Database (Memory)', () => {
  it('should write, read, and delete a value', async () => {
    const database = new Database()
    const brick = new Brick({ database })
    const instance = database.interface as KeyValueInterface

    await instance.set('foo', 'bar')
    expect(await instance.get('foo')).toEqual('bar')

    await instance.delete('foo')
    expect(await instance.get('foo')).toBeUndefined()

    expect(brick.db!.memory).toEqual({})
  })

  it('should dump the database', async () => {
    const db = new Database()
    const instance = db.interface as KeyValueInterface

    await instance.set('foo', 'bar')
    await instance.set('baz', 'qux')
    expect(await instance.dump()).toEqual({ foo: 'bar', baz: 'qux' })
  })
})

describe('Database (SQL)', () => {
  it('should create a table then populate, read, and drop it', async () => {
    const database = new Database({ service: 'sql', uri: process.env['DATABASE_URI'] })
    const instance = database.interface as SQLInterface

    await instance.query('CREATE TABLE IF NOT EXISTS brixtest (key VARCHAR(255) PRIMARY KEY, value VARCHAR(255))')
    await instance.query('INSERT INTO brixtest (key, value) VALUES (?, ?)', ['foo', 'bar'])

    const [results] = await instance.query('SELECT * FROM brixtest WHERE key = ?', ['foo'])
    expect(results[0].value).toEqual('bar')

    await instance.query('DROP TABLE brixtest')
    instance.disconnect()
  })
})
