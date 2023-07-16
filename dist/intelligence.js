"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = require("openai");
class Intelligence {
    constructor(opts) {
        this.service = opts.service || 'openai';
        this.model = opts.model || 'gpt-3.5-turbo';
        this.system = opts.system || 'You are a friendly assistant, ready to help with any task';
        this.functions = opts.functions;
        switch (this.service) {
            case 'openai':
                this.instance = new openai_1.OpenAIApi(new openai_1.Configuration({ apiKey: opts.key }));
                break;
            case 'custom':
                this.instance = opts.method || ((payload) => Promise.resolve(payload));
                break;
            default:
                throw new Error('Invalid service');
        }
    }
    async ask(question, context) {
        var _a, _b, _c, _d, _e, _f, _g;
        switch (this.service) {
            case 'openai':
                let messages = [{ role: 'system', content: this.system }];
                if (context)
                    messages = [...messages, ...context];
                messages = [...messages, { role: 'user', content: typeof question === 'string' ? question : JSON.stringify(question) }];
                try {
                    const response = await this.instance.createChatCompletion({
                        model: this.model,
                        functions: (_a = this.functions) === null || _a === void 0 ? void 0 : _a.schema,
                        messages
                    });
                    if (!((_c = (_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.choices) === null || _c === void 0 ? void 0 : _c[0]))
                        throw new Error('Invalid response from AI');
                    let functionResult;
                    if ((_d = response.data.choices[0].message) === null || _d === void 0 ? void 0 : _d.function_call) {
                        const { function_call } = response.data.choices[0].message;
                        if (!(function_call === null || function_call === void 0 ? void 0 : function_call.name))
                            throw new Error('Invalid function call');
                        const method = (_e = this.functions) === null || _e === void 0 ? void 0 : _e.methods[function_call.name];
                        if (!method)
                            throw new Error('Invalid function call');
                        functionResult = await method(JSON.parse(function_call.arguments || '{}'));
                    }
                    return {
                        text: (_f = response.data.choices[0].message) === null || _f === void 0 ? void 0 : _f.content,
                        context: [...messages, response.data.choices[0].message],
                        function_result: functionResult,
                        finish_reason: response.data.choices[0].finish_reason,
                        usage: response.data.usage
                    };
                }
                catch (err) {
                    console.error(((_g = err.response) === null || _g === void 0 ? void 0 : _g.data) || err.message);
                    throw new Error(err.message);
                }
            case 'custom':
                return await this.instance(question);
            default:
                throw new Error('Invalid service');
        }
    }
    async image(prompt, size = '256x256') {
        var _a;
        switch (this.service) {
            case 'openai':
                try {
                    const response = await this.instance.createImage({ prompt, size });
                    const image = response.data;
                    return {
                        response,
                        image
                    };
                }
                catch (err) {
                    console.error(((_a = err.response) === null || _a === void 0 ? void 0 : _a.data) || err.message);
                    throw new Error(err.message);
                }
            case 'custom':
                return await this.instance(prompt);
            default:
                throw new Error('Invalid service');
        }
    }
}
exports.default = Intelligence;
