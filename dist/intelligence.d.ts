import { ChatCompletionFunctions, ChatCompletionRequestMessageRoleEnum, CreateImageRequestSizeEnum, OpenAIApi } from 'openai';
export type IntelligenceService = 'openai' | 'custom';
export type IntelligenceOptions = {
    service?: IntelligenceService;
    model?: string;
    system?: string;
    key?: string;
    method?: (payload: any) => Promise<any>;
    functions?: {
        schema: ChatCompletionFunctions[];
        methods: {
            [key: string]: (payload: any) => Promise<any>;
        };
    };
};
export default class Intelligence {
    service: IntelligenceService;
    model: string;
    system: string;
    instance: OpenAIApi | ((payload: any) => Promise<any>);
    functions?: {
        schema: ChatCompletionFunctions[];
        methods: {
            [key: string]: (payload: any) => Promise<any>;
        };
    };
    constructor(opts: IntelligenceOptions);
    ask(question: any, context?: [{
        role: ChatCompletionRequestMessageRoleEnum;
        content: string;
    }]): Promise<any>;
    image(prompt: string, size?: CreateImageRequestSizeEnum): Promise<any>;
}
