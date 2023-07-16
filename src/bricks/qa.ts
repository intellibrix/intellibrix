import Brick, { BrickOptions } from '../brick'

export default class QA extends Brick {
  constructor(opts: BrickOptions = {}) {
    super(opts)

    this.program({
      name: 'qa',
      description: 'Return an answer to a question',
      steps: [
        {
          name: 'Get Answer',
          description: 'Get the answer to the question',
          actions: [
            {
              name: 'Get Answer',
              description: 'Get the answer to the question',
              method: async (payload: any) => {
                if (!this.ai) throw new Error('AI not configured')
                return this.ai.ask(payload.question)
              }
            }
          ]
        }
      ]
    })
  }
}
