import { describe, expect, it } from 'vitest'
import { Brick, Intelligence } from '../src/index.js'

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
              description: 'The answer to the question',
            },
            explanation: {
              type: 'string',
              description: 'The explanation of the answer',
            },
          },
        },
      },
    ],

    methods: {
      return_answer: async (payload: any) => {
        payload.processed = true
        return payload
      },
    },
  },
})

describe('Intelligence Function Brick', () => {
  it('should get the AI to call our function', async () => {
    const brick = new Brick({ intelligence })
    expect(brick.ai).toBeDefined()
    if (process.env['USE_OPENAI'] !== 'true') return
    if (!brick.ai) throw new Error('AI not configured')
    const result = await brick.ai.ask('What is 42 + 42?')
    expect(result.function_result.answer).toEqual('84')
    expect(result.function_result.processed).toEqual(true)
    expect(result.function_result.explanation).toBeDefined()
  }, 20000)
})
