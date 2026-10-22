import { Brick, defineTool, fromJSONSchema } from 'intellibrix'
import { serveMcp } from '../../dist/index.mjs'

const brick = new Brick({ name: 'stdio-fixture' })
brick.use([
  defineTool({
    name: 'shout',
    description: 'Uppercases text',
    input: fromJSONSchema({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    }),
    execute: async ({ text }) => text.toUpperCase(),
  }),
])

await serveMcp(brick, { transport: 'stdio' })
