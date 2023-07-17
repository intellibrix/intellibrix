import {
  ChatCompletionFunctions,
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum,
  Configuration,
  CreateImageRequestSizeEnum,
  OpenAIApi
} from 'openai'

/**
 * Represents the type of intelligence service to be used.
 */
export type IntelligenceService = 'openai' | 'custom'

/**
 * Represents the options for creating an Intelligence instance.
 */
export type IntelligenceOptions = {
  // The type of intelligence service to use
  service?: IntelligenceService
  // The model to use for the AI
  model?: string
  // The system message to use in the chat
  system?: string
  // The API key for the intelligence service
  key?: string
  // The method to use for the custom intelligence service
  method?: (payload: any) => Promise<any>
  // The functions to use for the intelligence service (OpenAI only)
  functions?: {
    schema: ChatCompletionFunctions[],
    methods: { [key: string]: (payload: any) => Promise<any> }
  }
}

/**
 * Represents an intelligence service that can be used by a {@link Brick} to process and respond to messages.
 * @remarks Currently, only OpenAI and custom functions are supported.
 */
export default class Intelligence {
  // The type of intelligence service to use
  service: IntelligenceService
  // The model to use for the AI
  model: string
  // The system message to use in the chat
  system: string
  // The instance of the intelligence service
  instance: OpenAIApi | ((payload: any) => Promise<any>)
  // The functions to use for the intelligence service
  functions?: {
    schema: ChatCompletionFunctions[],
    methods: { [key: string]: (payload: any) => Promise<any> }
  }

  /**
   * Creates a new instance of the Intelligence class.
   * @param options The options to use for creating the Intelligence instance.
   */
  constructor(options: IntelligenceOptions) {
    // Initialize properties from options
    this.service = options.service || 'openai'
    this.model = options.model || 'gpt-3.5-turbo'
    this.system = options.system || 'You are a friendly assistant, ready to help with any task'
    this.functions = options.functions
    
    // Initialize the intelligence service instance
    switch (this.service) {
      case 'openai':
        this.instance = new OpenAIApi(new Configuration({ apiKey: options.key }))
        break
      case 'custom':
        this.instance = options.method || ((payload) => Promise.resolve(payload))
        break
      default:
        throw new Error('Invalid service')
    }
  }

  /**
   * Sends a message to the intelligence service and gets a response.
   * @param question The question to ask the intelligence service.
   * @param context The context for the question.
   * @returns The response from the intelligence service.
   */
  async ask(question: any, context?: [{ role: ChatCompletionRequestMessageRoleEnum, content: string }]) {
    switch (this.service) {
      case 'openai':
        let messages: ChatCompletionRequestMessage[] = [{ role: 'system', content: this.system }]
        if (context) messages = [...messages, ...context]
        messages = [...messages, { role: 'user', content: typeof question === 'string' ? question : JSON.stringify(question) }]

        try {
          const response = await (this.instance as OpenAIApi).createChatCompletion({
            model: this.model,
            functions: this.functions?.schema,
            messages
          })

          if (!response?.data?.choices?.[0]) throw new Error('Invalid response from AI')

          let functionResult
          if (response.data.choices[0].message?.function_call) {
            const { function_call } = response.data.choices[0].message
            if (!function_call?.name) throw new Error('Invalid function call')
            const method = this.functions?.methods[function_call.name]
            if (!method) throw new Error('Invalid function call')
            functionResult = await method(JSON.parse(function_call.arguments || '{}'))
          }

          return {
            text: response.data.choices[0].message?.content,
            context: [...messages, response.data.choices[0].message],
            function_result: functionResult,
            finish_reason: response.data.choices[0].finish_reason,
            usage: response.data.usage
          }
        } catch (err) {
          console.error((err as any).response?.data || (err as any).message)
          throw new Error((err as any).message)
        }

      case 'custom':
        return await (this.instance as (payload: any) => Promise<any>)(question)
      
      default:
        throw new Error('Invalid service')
    }
  }

  /**
   * Requests an image from the intelligence service (if supported).
   * @param prompt The prompt for the image.
   * @param size The size of the image.
   * @returns The image from the intelligence service.
   */
  async image(prompt: string, size: CreateImageRequestSizeEnum = '256x256') {
    switch (this.service) {
      case 'openai':
        try {
          const response = await (this.instance as OpenAIApi).createImage({ prompt, size })
          const image = response.data

          return {
            response,
            image
          }
        } catch (err) {
          console.error((err as any).response?.data || (err as any).message)
          throw new Error((err as any).message)
        }

      case 'custom':
        return await (this.instance as (payload: any) => Promise<any>)(prompt)
      
      default:
        throw new Error('Invalid service')
    }
  }
}
