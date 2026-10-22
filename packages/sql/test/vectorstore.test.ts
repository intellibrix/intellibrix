import { vectorStoreContract } from 'intellibrix/testing'
import { Sequelize } from 'sequelize'
import { afterAll, describe, expect, it } from 'vitest'
import { PgVectorStore } from '../src/vectorstore.js'

const uri = process.env['PGVECTOR_URI']

describe('PgVectorStore construction', () => {
  it('requires a Postgres connection', () => {
    const sequelize = new Sequelize('sqlite::memory:', { logging: false })
    expect(() => new PgVectorStore({ sequelize, dimensions: 3 })).toThrow('requires a Postgres')
  })

  it('requires a positive integer dimension and a safe table name', () => {
    const sequelize = new Sequelize('postgres://u:p@127.0.0.1:1/db', { logging: false })
    expect(() => new PgVectorStore({ sequelize, dimensions: 0 })).toThrow('positive integer')
    expect(() => new PgVectorStore({ sequelize, dimensions: 1.5 })).toThrow('positive integer')
    expect(() => new PgVectorStore({ sequelize, dimensions: 3, tableName: 'a; b' })).toThrow(
      'Invalid table name',
    )
  })

  it('rejects dimension mismatches before touching the database', async () => {
    // Port 1 is unreachable: reaching the database would fail with a connection error instead.
    const sequelize = new Sequelize('postgres://u:p@127.0.0.1:1/db', { logging: false })
    const store = new PgVectorStore({ sequelize, dimensions: 3 })

    await expect(store.upsert([{ id: 'a', vector: [1, 2] }])).rejects.toThrow(
      'has 2 dimensions, expected 3',
    )
    await expect(store.query([1, 2, 3, 4])).rejects.toThrow('has 4 dimensions, expected 3')
    await expect(store.query([1, Number.NaN, 3])).rejects.toThrow('non-finite')
  })
})

// Needs Postgres with pgvector, e.g.
//   docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 pgvector/pgvector:pg17
//   PGVECTOR_URI=postgres://postgres:pw@localhost:5432/postgres pnpm test
describe.skipIf(!uri)('PgVectorStore (live pgvector)', () => {
  const sequelize = new Sequelize(uri ?? 'postgres://unused', { logging: false })
  let counter = 0
  const tables: string[] = []

  afterAll(async () => {
    for (const table of tables) await sequelize.query(`DROP TABLE IF EXISTS ${table}`)
    await sequelize.close()
  })

  const make = () => {
    const tableName = `brix_vec_${process.pid}_${counter++}`
    tables.push(tableName)
    return new PgVectorStore({ sequelize, dimensions: 3, tableName })
  }

  for (const c of vectorStoreContract(make, { dimensions: 3 })) it(c.name, c.run)

  it('rejects a mismatch against an existing table', async () => {
    const store = make()
    await store.upsert([{ id: 'a', vector: [1, 0, 0] }])
    await expect(store.upsert([{ id: 'b', vector: [1, 0] }])).rejects.toThrow('expected 3')
  })
})
