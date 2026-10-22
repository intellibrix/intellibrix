// pnpm --filter example-supervisor start
// Runs offline: every model is a scripted MockProvider. Swap in `provider('anthropic:...')`
// from @intellibrix/ai-sdk to use real models.

import { supervisor } from '@intellibrix/structures'
import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'

const researcher = new Brick({
  name: 'researcher',
  logLevel: 'fatal',
  intelligence: new Intelligence({
    provider: new MockProvider([{ text: 'Bricks compose into Structures.' }]),
    model: 'mock',
  }),
})

const lead = new Intelligence({
  provider: new MockProvider([
    { toolCalls: [{ toolName: 'researcher', input: { prompt: 'What are Structures?' } }] },
    { text: 'Per the researcher: bricks compose into Structures.' },
  ]),
  model: 'mock',
})

const team = supervisor({ supervisor: lead, bricks: [researcher] })
console.log((await team.ask('Explain Structures')).text)
