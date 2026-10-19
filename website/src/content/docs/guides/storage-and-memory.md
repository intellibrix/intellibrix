---
title: Storage and memory
description: Conversation memory, key-value stores and vector search, from in-memory to SQLite to Postgres.
---

intellibrix defines three small storage interfaces in core. Each has an in-memory implementation
for tests and prototypes, and durable ones in separate packages.

| Interface | Used for | In memory | SQLite | SQL / Postgres |
|---|---|---|---|---|
| `ConversationMemory` | Chat history per thread | `MemoryConversationMemory` | `SQLiteConversationMemory` | |
| `KeyValueStore` | Brick state, caches | `MemoryKeyValueStore` | | `SQLKeyValueStore` |
| `VectorStore` | Semantic search | `MemoryVectorStore` | `SQLiteVectorStore` | `PgVectorStore` |

## Conversation memory

Pass `memory` to `Intelligence` and a `threadId` to `ask`. Each thread is its own conversation.

```ts
import { SQLiteConversationMemory } from '@intellibrix/memory-sqlite'

const intelligence = new Intelligence({
  provider,
  model,
  memory: new SQLiteConversationMemory({ path: './chat.db' }),
})

await intelligence.ask('I prefer tabs', { threadId: 'user-42' })
```

`@intellibrix/memory-sqlite` uses Node's built-in `node:sqlite`, so there is nothing native to
build. Pass `path: ':memory:'` (the default) for a throwaway database, or `database` to share
one connection between the memory and vector stores. `tableName` is validated as a plain SQL
identifier. The interface is three methods, `append`, `getMessages` and `clear`.

## Key-value stores

```ts
import { SQLKeyValueStore } from '@intellibrix/sql'
import { Sequelize } from 'sequelize'

const kv = new SQLKeyValueStore({ sequelize: new Sequelize(process.env.DATABASE_URL!) })
await kv.set('settings:42', { theme: 'dark' })
await kv.get('settings:42') // { theme: 'dark' }
```

Values are stored as JSON text with a parametrized upsert, in `intellibrix_kv` unless you pass
`tableName`. It works with any dialect Sequelize supports.

## Vector search

Embed text with a provider that implements `embed`, then store and query vectors:

```ts
import { MemoryVectorStore } from 'intellibrix'

const store = new MemoryVectorStore()
const [vector] = await provider.embed!(['Refunds take 5 business days'])
await store.upsert([{ id: 'faq-1', vector, metadata: { text: 'Refunds take 5 business days' } }])

const [query] = await provider.embed!(['how long do refunds take?'])
const matches = await store.query(query, { topK: 3 }) // [{ id, vector, metadata, score }]
```

`score` is cosine similarity in every implementation, so you can swap stores without retuning a
threshold.

For a persistent store pick one:

```ts
// SQLite, no extra services
import { SQLiteVectorStore } from '@intellibrix/memory-sqlite'
const sqlite = new SQLiteVectorStore({ path: './vectors.db' })

// Postgres with pgvector (HNSW index by default)
import { PgVectorStore } from '@intellibrix/sql'
const pg = new PgVectorStore({ sequelize, dimensions: 1536 })
```

`PgVectorStore` creates the extension and table on first use. `dimensions` is required and must
match your embedding model, because pgvector columns have a fixed width.

## Writing your own

Implement the interface and run the matching contract suite from
[`intellibrix/testing`](/guides/testing/) (`conversationMemoryContract`, and its siblings for key-value
and vector stores). If it passes, it behaves like the built-ins.
