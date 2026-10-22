// pnpm --filter example-mcp-server start
// then: claude mcp add words -- pnpm --filter example-mcp-server start
import { Brick } from 'intellibrix'
import { z } from 'zod'

const brick = new Brick({ name: 'words' })

brick.program({
  name: 'word_count',
  description: 'Count the words in a piece of text.',
  input: z.object({ text: z.string() }),
  steps: [
    {
      actions: [
        {
          method: async ({ text }: { text: string }) => ({
            words: text.split(/\s+/).filter(Boolean).length,
          }),
        },
      ],
    },
  ],
})

export default brick
