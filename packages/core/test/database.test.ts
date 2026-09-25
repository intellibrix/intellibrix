import { describe, expect, it } from 'vitest'
import Brick from '../src/brick.js'
import Database, { type KeyValueInterface } from '../src/database.js'

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
