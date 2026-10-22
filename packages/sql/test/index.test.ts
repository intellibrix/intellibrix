import { describe, expect, it } from 'vitest'
import SQLDatabase from '../src/index.js'

describe('SQLDatabase', () => {
  it.skipIf(!process.env['DATABASE_URI'])(
    'should create a table then populate, read, and drop it',
    async () => {
      const database = new SQLDatabase({ uri: process.env['DATABASE_URI']! })
      const instance = database.interface

      await instance.query(
        'CREATE TABLE IF NOT EXISTS brixtest (key VARCHAR(255) PRIMARY KEY, value VARCHAR(255))',
      )
      await instance.query('INSERT INTO brixtest (key, value) VALUES (?, ?)', ['foo', 'bar'])

      const [results] = await instance.query('SELECT * FROM brixtest WHERE key = ?', ['foo'])
      expect(results[0].value).toEqual('bar')

      await instance.query('DROP TABLE brixtest')
      instance.disconnect()
    },
  )

  it('should create a table, insert data, read data, update data, and delete data (sqlite in-memory)', async () => {
    const database = new SQLDatabase({ uri: 'sqlite::memory:' })
    const db = database.interface

    await db.query(
      'CREATE TABLE IF NOT EXISTS brixtest (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)',
    )
    await db.query('INSERT INTO brixtest (name, age) VALUES (?, ?)', ['Belisarius Cawl', 10000])
    const [results] = await db.query('SELECT * FROM brixtest')
    expect(results).toEqual([{ id: 1, name: 'Belisarius Cawl', age: 10000 }])
  })
})
