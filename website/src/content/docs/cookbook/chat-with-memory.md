---
title: A chat that remembers
description: Persist conversations across turns, and across restarts, with SQLite memory.
---

```ts
import { provider } from '@intellibrix/ai-sdk'
import { SQLiteConversationMemory } from '@intellibrix/memory-sqlite'
import { Intelligence } from 'intellibrix'

const intelligence = new Intelligence({
  provider: provider('anthropic:claude-sonnet-5'),
  model: 'claude-sonnet-5',
  memory: new SQLiteConversationMemory({ path: './chat.db' }),
})

await intelligence.ask('My name is Ada', { threadId: 'ada' })
const { text } = await intelligence.ask('What is my name?', { threadId: 'ada' })
console.log(text) // "Your name is Ada."
```

Each `threadId` is its own conversation. `@intellibrix/memory-sqlite` uses Node's built-in
`node:sqlite`, so there is nothing native to install. For a shared database, `@intellibrix/sql`
provides a SQL-backed store. To implement your own, run the `conversationMemoryContract` suite from
[`intellibrix/testing`](/guides/testing/).
