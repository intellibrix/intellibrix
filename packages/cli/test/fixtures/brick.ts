import { Brick } from 'intellibrix'
import { z } from 'zod'

const brick = new Brick({ name: 'fixture', logLevel: 'fatal' })
brick.program({
  name: 'double',
  description: 'Double a number.',
  input: z.object({ n: z.number() }),
  steps: [{ actions: [{ method: async ({ n }: { n: number }) => ({ result: n * 2 }) }] }],
})

export default brick
