"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _Brick_programs;
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const events_1 = __importDefault(require("events"));
const pino_1 = __importDefault(require("pino"));
class Brick {
    constructor(opts = {}) {
        _Brick_programs.set(this, void 0);
        const logger = (0, pino_1.default)(opts.pinoOptions || {
            transport: opts.logJSON ? undefined : {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    ignore: 'pid,hostname'
                }
            }
        });
        this.id = (0, crypto_1.randomUUID)();
        this.ai = opts.intelligence;
        this.db = opts.database;
        this.name = opts.name || this.id;
        this.structure = opts.structure;
        this.log = logger.child({ name: `BRICK:${this.name}` });
        this.log.level = opts.logLevel || 'debug';
        this.events = new events_1.default();
        __classPrivateFieldSet(this, _Brick_programs, {}, "f");
        this.log.debug('Brick created');
    }
    get programs() {
        return __classPrivateFieldGet(this, _Brick_programs, "f");
    }
    async run(name, payload) {
        var _a;
        let result;
        const program = __classPrivateFieldGet(this, _Brick_programs, "f")[name];
        if (!program)
            throw new Error('Program does not exist');
        this.events.emit('run', { name, payload });
        (_a = this.structure) === null || _a === void 0 ? void 0 : _a.events.emit('run', { brick: this, name, payload });
        this.log.info(`Running program ${name}`);
        for (const step of program.steps) {
            for (const action of step.actions) {
                result = await action.method(payload, this);
                payload = result;
            }
        }
        return result;
    }
    program(program) {
        var _a;
        if (!program.name)
            program.name = (0, crypto_1.randomUUID)();
        if (__classPrivateFieldGet(this, _Brick_programs, "f")[program.name])
            throw new Error('Program already exists');
        __classPrivateFieldGet(this, _Brick_programs, "f")[program.name] = program;
        this.events.emit('program', program);
        (_a = this.structure) === null || _a === void 0 ? void 0 : _a.events.emit('program', { brick: this, program });
        this.log.info(`Program Added: ${program.name}`);
    }
    deprogram(name) {
        var _a;
        if (!__classPrivateFieldGet(this, _Brick_programs, "f")[name])
            throw new Error('Program does not exist');
        delete __classPrivateFieldGet(this, _Brick_programs, "f")[name];
        this.events.emit('deprogram', name);
        (_a = this.structure) === null || _a === void 0 ? void 0 : _a.events.emit('deprogram', { brick: this, name });
        this.log.info(`Program Removed: ${name}`);
    }
}
_Brick_programs = new WeakMap();
exports.default = Brick;
