import assert from 'node:assert/strict'

import type { ConversationMemory, KeyValueStore, VectorStore } from './database.js'
import { type Message, textMessage } from './messages.js'

/**
 * A single named check from a store contract. Register each with your test
 * runner: `for (const c of cases) it(c.name, c.run)`.
 */
export type ContractCase = { name: string; run: () => Promise<void> }

type Factory<T> = () => T | Promise<T>

/**
 * Behavior every {@link KeyValueStore} implementation must share. Runner-agnostic
 * (plain `node:assert`), so any package can reuse it from `intellibrix/testing`.
 */
export function keyValueStoreContract(make: Factory<KeyValueStore>): ContractCase[] {
  return [
    {
      name: 'returns undefined for a missing key',
      run: async () => {
        assert.equal(await (await make()).get('missing'), undefined)
      },
    },
    {
      name: 'round-trips JSON values',
      run: async () => {
        const store = await make()
        await store.set('s', 'text')
        await store.set('n', 42)
        await store.set('o', { nested: [1, { deep: true }] })
        assert.equal(await store.get('s'), 'text')
        assert.equal(await store.get('n'), 42)
        assert.deepEqual(await store.get('o'), { nested: [1, { deep: true }] })
      },
    },
    {
      name: 'overwrites on repeated set()',
      run: async () => {
        const store = await make()
        await store.set('k', 1)
        await store.set('k', 2)
        assert.equal(await store.get('k'), 2)
      },
    },
    {
      name: 'deletes an existing key',
      run: async () => {
        const store = await make()
        await store.set('k', 1)
        assert.equal(await store.delete('k'), true)
        assert.equal(await store.get('k'), undefined)
      },
    },
    {
      name: 'dump() returns every entry and load() restores them',
      run: async () => {
        const source = await make()
        await source.set('a', 1)
        await source.set('b', { two: 2 })
        const dumped = { ...(await source.dump()) }
        assert.deepEqual(dumped, { a: 1, b: { two: 2 } })

        const target = await make()
        await target.load(dumped)
        assert.equal(await target.get('a'), 1)
        assert.deepEqual(await target.get('b'), { two: 2 })
      },
    },
  ]
}

/**
 * Behavior every {@link ConversationMemory} implementation must share.
 */
export function conversationMemoryContract(make: Factory<ConversationMemory>): ContractCase[] {
  return [
    {
      name: 'returns an empty list for an unknown thread',
      run: async () => {
        assert.deepEqual(await (await make()).getMessages('nope'), [])
      },
    },
    {
      name: 'preserves append order',
      run: async () => {
        const memory = await make()
        const messages = ['one', 'two', 'three'].map((text) => textMessage('user', text))
        for (const message of messages) await memory.append('t', message)
        assert.deepEqual(await memory.getMessages('t'), messages)
      },
    },
    {
      name: 'round-trips every part type, including trust',
      run: async () => {
        const memory = await make()
        const assistant: Message = {
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling', trust: 'trusted' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a.ts' } },
          ],
        }
        const tool: Message = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'read',
              output: { text: 'file body' },
              isError: false,
              trust: 'untrusted',
            },
          ],
        }
        await memory.append('t', assistant)
        await memory.append('t', tool)
        assert.deepEqual(await memory.getMessages('t'), [assistant, tool])
      },
    },
    {
      name: 'isolates threads and clears only the requested one',
      run: async () => {
        const memory = await make()
        await memory.append('a', textMessage('user', 'in a'))
        await memory.append('b', textMessage('user', 'in b'))
        await memory.clear('a')
        assert.deepEqual(await memory.getMessages('a'), [])
        assert.equal((await memory.getMessages('b')).length, 1)
      },
    },
    {
      name: 'does not expose internal state through the returned array',
      run: async () => {
        const memory = await make()
        await memory.append('t', textMessage('user', 'hi'))
        const first = await memory.getMessages('t')
        first.length = 0
        assert.equal((await memory.getMessages('t')).length, 1)
      },
    },
  ]
}

/**
 * Behavior every {@link VectorStore} implementation must share. `dimensions`
 * is the vector length the store under test was constructed for (default 3).
 */
export function vectorStoreContract(
  make: Factory<VectorStore>,
  opts: { dimensions?: number } = {},
): ContractCase[] {
  const dimensions = opts.dimensions ?? 3
  const axis = (index: number, scale = 1): number[] =>
    Array.from({ length: dimensions }, (_, i) => (i === index ? scale : 0))

  return [
    {
      name: 'ranks by cosine similarity, best first',
      run: async () => {
        const store = await make()
        await store.upsert([
          { id: 'x', vector: axis(0) },
          { id: 'y', vector: axis(1) },
          { id: 'near-x', vector: axis(0).map((v, i) => v + (i === 1 ? 0.1 : 0)) },
        ])
        const matches = await store.query(axis(0), { topK: 3 })
        assert.deepEqual(
          matches.map((match) => match.id),
          ['x', 'near-x', 'y'],
        )
        assert.ok(Math.abs((matches[0]?.score ?? 0) - 1) < 1e-6)
        assert.ok((matches[0]?.score ?? 0) >= (matches[1]?.score ?? 0))
        assert.ok((matches[1]?.score ?? 0) >= (matches[2]?.score ?? 0))
      },
    },
    {
      name: 'honors topK',
      run: async () => {
        const store = await make()
        await store.upsert([
          { id: 'a', vector: axis(0) },
          { id: 'b', vector: axis(1) },
        ])
        assert.equal((await store.query(axis(0), { topK: 1 })).length, 1)
      },
    },
    {
      name: 'round-trips metadata and replaces on upsert of the same id',
      run: async () => {
        const store = await make()
        await store.upsert([{ id: 'a', vector: axis(0), metadata: { source: 'first', n: 1 } }])
        await store.upsert([{ id: 'a', vector: axis(1), metadata: { source: 'second' } }])

        const matches = await store.query(axis(1), { topK: 5 })
        assert.equal(matches.length, 1)
        assert.deepEqual(matches[0]?.metadata, { source: 'second' })
        assert.ok(Math.abs((matches[0]?.score ?? 0) - 1) < 1e-6)
      },
    },
    {
      name: 'deletes records by id',
      run: async () => {
        const store = await make()
        await store.upsert([
          { id: 'a', vector: axis(0) },
          { id: 'b', vector: axis(1) },
        ])
        await store.delete(['a'])
        const matches = await store.query(axis(0), { topK: 5 })
        assert.deepEqual(
          matches.map((match) => match.id),
          ['b'],
        )
      },
    },
  ]
}
