// ANTHROPIC_API_KEY=... pnpm --filter example-qa start
// Without a key this runs offline against a stub provider.
import { provider } from '@intellibrix/ai-sdk'
import { customProvider, Intelligence } from 'intellibrix'
import QABrick from './qa-brick.js'

const live = Boolean(process.env.ANTHROPIC_API_KEY)

const brick = new QABrick({
  logLevel: 'fatal',
  intelligence: new Intelligence({
    provider: live
      ? provider('anthropic:claude-sonnet-5')
      : customProvider(async () => '84 (42 + 42)'),
    model: live ? 'claude-sonnet-5' : 'stub',
    system: 'Answer the question as briefly as possible.',
  }),
})

const { text } = await brick.run('qa', { question: 'What is 42 + 42?' })
console.log(text)
