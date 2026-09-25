import { customProvider, Intelligence } from 'intellibrix'
import QABrick from './qa-brick.js'

async function main() {
  // TODO(phase3): swap this stub for `@intellibrix/ai-sdk`'s `provider('anthropic:claude-sonnet-5')`
  // once that package exists. `customProvider` lets this example run standalone until then.
  const provider = customProvider(async () => '84 (42 + 42)')

  const brick = new QABrick({
    intelligence: new Intelligence({ provider, model: 'mock' }),
  })

  const result = await brick.run('qa', { question: 'What is 42 + 42?' })
  console.log(result)
}

main()
