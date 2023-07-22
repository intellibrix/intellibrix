import Brick, { BrickOptions } from '../brick'

/**
 * Class representing a QA (Question-Answer) brick.
 * It extends from the {@link Core.Brick} class.
 */
export default class QA extends Brick {
  /**
   * Creates a new QA brick.
   * @param options - The options for the QA brick.
   */
  constructor(options: BrickOptions = {}) {
    super(options)

    // Define a program for the QA brick.
    this.program({
      /** The name of the program. */
      name: 'qa',
      /** The description of the program. */
      description: 'Return an answer to a question',
      /** The steps to be executed in the program. */
      steps: [
        {
          /** The name of the step. */
          name: 'Get Answer',
          /** The description of the step. */
          description: 'Get the answer to the question',
          /** The actions to be performed in the step. */
          actions: [
            {
              /** The name of the action. */
              name: 'Get Answer',
              /** The description of the action. */
              description: 'Get the answer to the question',
              /** The method to be executed in the action. */
              method: async (payload: any) => {
                // If the AI is not configured, throw an error.
                if (!this.ai) throw new Error('AI not configured')
                // Ask the AI the question and return the answer.
                return this.ai.ask(payload.question)
              }
            }
          ]
        }
      ]
    })
  }
}
