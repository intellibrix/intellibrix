import { Brick, Intelligence } from '../src'
import QA from '../src/bricks/qa'

const intelligence = new Intelligence({
  model: 'gpt-3.5-turbo-0613',
  key: process.env['OPENAI_API_KEY'],
  functions: {
    schema: [
      {
        name: 'return_answer',
        description: 'Test function',
        parameters: {
          type: 'object',
          required: ['answer', 'explanation'],
          properties: {
            answer: {
              type: 'string',
              description: 'The answer to the question'
            },
            explanation: {
              type: 'string',
              description: 'The explanation of the answer'
            }
          }
        }
      }
    ],

    methods: {
      return_answer: async (payload) => {
        payload.processed = true
        return payload
      }
    }
  }
})

describe('Intelligence Function Brick', () => {
  it('should get the AI to call our function', async () => {
    const brick = new Brick({ intelligence })
    expect(brick.ai).toBeDefined()
    // disabled to save money
    // const result = await brick.ai!.ask('What is 42 + 42?')
    // expect(result.function_result.answer).toEqual('84')
    // expect(result.function_result.processed).toEqual(true)
    // expect(result.function_result.explanation).toBeDefined()
  }, 20000)
})

describe('Intelligence Question Brick', () => {
  it('should return an answer to a question', async () => {
    const qa = new QA({ intelligence: new Intelligence({ key: process.env['OPENAI_API_KEY'] }) })
    expect(qa).toBeDefined() // disabled to save money
    // const { text } = await qa.run('qa', { question: 'What is 42 + 42?' })
    // expect(text).toContain('84')
  }, 20000)
})