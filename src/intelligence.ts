import {
  ChatCompletionFunctions,
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum,
  Configuration,
  CreateImageRequestSizeEnum,
  OpenAIApi
} from 'openai'

export type IntelligenceService = 'openai' | 'custom'

export type IntelligenceOptions = {
  service?: IntelligenceService
  model?: string
  system?: string
  key?: string
  method?: (payload: any) => Promise<any>
  functions?: {
    schema: ChatCompletionFunctions[],
    methods: { [key: string]: (payload: any) => Promise<any> }
  }
}

export default class Intelligence {
  service: IntelligenceService
  model: string
  system: string
  instance: OpenAIApi | ((payload: any) => Promise<any>)
  functions?: {
    schema: ChatCompletionFunctions[],
    methods: { [key: string]: (payload: any) => Promise<any> }
  }

  constructor(opts: IntelligenceOptions) {
    this.service = opts.service || 'openai'
    this.model = opts.model || 'gpt-3.5-turbo'
    this.system = opts.system || 'You are a friendly assistant, ready to help with any task'
    this.functions = opts.functions
    
    switch (this.service) {
      case 'openai':
        this.instance = new OpenAIApi(new Configuration({ apiKey: opts.key }))
        break
      case 'custom':
        this.instance = opts.method || ((payload) => Promise.resolve(payload))
        break
      default:
        throw new Error('Invalid service')
    }
  }

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
