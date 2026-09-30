import { keyValueStoreContract } from 'intellibrix/testing'
import { Sequelize } from 'sequelize'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SQLKeyValueStore } from '../src/keyvalue.js'

describe('SQLKeyValueStore (sqlite in-memory)', () => {
  let store: SQLKeyValueStore

  beforeEach(() => {
    const sequelize = new Sequelize('sqlite::memory:', { logging: false })
    store = new SQLKeyValueStore({ sequelize })
  })

  it('should write, read, and delete a value', async () => {
    await store.set('foo', 'bar')
    expect(await store.get('foo')).toEqual('bar')

    await store.delete('foo')
    expect(await store.get('foo')).toBeUndefined()
  })

  it('should upsert on repeated set()', async () => {
    await store.set('foo', 'bar')
    await store.set('foo', 'baz')
    expect(await store.get('foo')).toEqual('baz')
  })

  it('should dump all entries', async () => {
    await store.set('foo', 'bar')
    await store.set('baz', { nested: true })
    expect(await store.dump()).toEqual({ foo: 'bar', baz: { nested: true } })
  })

  it('should load entries in bulk', async () => {
    await store.load({ a: 1, b: 2 })
    expect(await store.get('a')).toEqual(1)
    expect(await store.get('b')).toEqual(2)
  })
})

describe('SQLKeyValueStore contract (sqlite in-memory)', () => {
  const make = () =>
    new SQLKeyValueStore({ sequelize: new Sequelize('sqlite::memory:', { logging: false }) })
  for (const c of keyValueStoreContract(make)) it(c.name, c.run)
})

describe.skipIf(!process.env['PGVECTOR_URI'])('SQLKeyValueStore contract (live postgres)', () => {
  const sequelize = new Sequelize(process.env['PGVECTOR_URI'] ?? 'postgres://unused', {
    logging: false,
  })
  let counter = 0
  const tables: string[] = []

  afterAll(async () => {
    for (const table of tables) await sequelize.query(`DROP TABLE IF EXISTS ${table}`)
    await sequelize.close()
  })

  const make = () => {
    const tableName = `brix_kv_${process.pid}_${counter++}`
    tables.push(tableName)
    return new SQLKeyValueStore({ sequelize, tableName })
  }
  for (const c of keyValueStoreContract(make)) it(c.name, c.run)
})
