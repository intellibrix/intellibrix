import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Intelligence, textMessage } from 'intellibrix'
import { conversationMemoryContract, MockProvider, vectorStoreContract } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import { SQLiteConversationMemory, SQLiteVectorStore } from '../src/index.js'

describe('SQLiteConversationMemory', () => {
  for (const c of conversationMemoryContract(() => new SQLiteConversationMemory()))
    it(c.name, c.run)

  it('persists across connections to the same file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'brix-')), 'memory.db')

    const first = new SQLiteConversationMemory({ path })
    await first.append('t', textMessage('user', 'remember me'))
    first.close()

    const second = new SQLiteConversationMemory({ path })
    expect(await second.getMessages('t')).toEqual([textMessage('user', 'remember me')])
    second.close()
  })

  it('does not close a shared connection', async () => {
    const database = new DatabaseSync(':memory:')
    new SQLiteConversationMemory({ database }).close()
    expect(database.isOpen).toBe(true)
    database.close()
  })

  it('rejects unsafe table names', () => {
    expect(() => new SQLiteConversationMemory({ tableName: 'x; DROP TABLE y' })).toThrow(
      'Invalid table name',
    )
  })

  it('backs Intelligence memory across asks', async () => {
    const memory = new SQLiteConversationMemory()
    const ai = new Intelligence({
      provider: new MockProvider([{ text: 'a' }, { text: 'b' }]),
      model: 'mock',
      memory,
    })
    await ai.ask('one', { threadId: 't' })
    await ai.ask('two', { threadId: 't' })
    expect((await memory.getMessages('t')).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })
})

describe('SQLiteVectorStore', () => {
  for (const c of vectorStoreContract(() => new SQLiteVectorStore({ dimensions: 3 })))
    it(c.name, c.run)

  it('rejects vectors of the wrong dimension', async () => {
    const store = new SQLiteVectorStore({ dimensions: 3 })
    await expect(store.upsert([{ id: 'a', vector: [1, 2] }])).rejects.toThrow('expected 3')
    await expect(store.query([1, 2])).rejects.toThrow('expected 3')
  })

  it('shares one connection with the conversation memory', async () => {
    const database = new DatabaseSync(':memory:')
    const memory = new SQLiteConversationMemory({ database })
    const vectors = new SQLiteVectorStore({ database })

    await memory.append('t', textMessage('user', 'hi'))
    await vectors.upsert([{ id: 'a', vector: [1, 0] }])
    expect(await memory.getMessages('t')).toHaveLength(1)
    expect(await vectors.query([1, 0])).toHaveLength(1)
  })
})
