# @intellibrix/memory-sqlite

`node:sqlite` conversation memory and vector store for intellibrix. No native dependencies.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/memory-sqlite intellibrix
```

## Usage

```typescript
import { SQLiteConversationMemory } from '@intellibrix/memory-sqlite'

const intelligence = new Intelligence({ provider, model, memory: new SQLiteConversationMemory({ path: './chat.db' }) })
```

Also exports `SQLiteVectorStore`. Requires Node 22+.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
