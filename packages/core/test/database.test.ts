import { describe, expect, it } from 'vitest'
import Brick from '../src/brick.js'
import { MemoryKeyValueStore, MemoryVectorStore } from '../src/database.js'

describe('MemoryKeyValueStore', () => {
  it('should write, read, and delete a value', async () => {
    const store = new MemoryKeyValueStore()
    const brick = new Brick({ database: store })

    await store.set('foo', 'bar')
    expect(await store.get('foo')).toEqual('bar')

    await store.delete('foo')
    expect(await store.get('foo')).toBeUndefined()

    expect(brick.db).toBe(store)
    expect(await store.dump()).toEqual({})
  })

  it('should dump the database', async () => {
    const store = new MemoryKeyValueStore()

    await store.set('foo', 'bar')
    await store.set('baz', 'qux')
    expect(await store.dump()).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('should load data into the database', async () => {
    const store = new MemoryKeyValueStore()
    await store.load({ foo: 'bar' })
    expect(await store.get('foo')).toEqual('bar')
  })
})

describe('Brick default database', () => {
  it('should default to an in-memory KeyValueStore', async () => {
    const brick = new Brick()
    await brick.db.set('foo', 'bar')
    expect(await brick.db.get('foo')).toEqual('bar')
  })
})

describe('MemoryVectorStore', () => {
  it('should upsert and query by cosine similarity', async () => {
    const store = new MemoryVectorStore()

    await store.upsert([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0, 1] },
    ])

    const matches = await store.query([1, 0], { topK: 1 })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.id).toEqual('a')
    expect(matches[0]?.score).toBeCloseTo(1)
  })

  it('should delete records', async () => {
    const store = new MemoryVectorStore()
    await store.upsert([{ id: 'a', vector: [1, 0] }])
    await store.delete(['a'])
    const matches = await store.query([1, 0])
    expect(matches).toHaveLength(0)
  })
})
