import { Intelligence } from 'intellibrix'
import QABrick from './qa-brick'

async function main() {
  const brick = new QABrick({
    intelligence: new Intelligence({ key: process.env['OPENAI_API_KEY'] }),
  })

  const result = await brick.run('qa', { question: 'What is 42 + 42?' })
  console.log(result)
}

main()
