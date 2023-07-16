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
var _Structure_bricks;
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const events_1 = __importDefault(require("events"));
const pino_1 = __importDefault(require("pino"));
class Structure {
    constructor(opts = {}, bricks = []) {
        _Structure_bricks.set(this, void 0);
        this.id = (0, crypto_1.randomUUID)();
        this.name = opts.name || this.id;
        __classPrivateFieldSet(this, _Structure_bricks, bricks, "f");
        this.events = new events_1.default();
        const logger = (0, pino_1.default)(opts.pinoOptions || {
            transport: opts.logJSON ? undefined : {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    ignore: 'pid,hostname'
                }
            }
        });
        this.log = logger.child({ name: `STRUCTURE:${this.name}` });
        this.log.level = opts.logLevel || 'debug';
        this.log.debug('Structure created');
    }
    get bricks() {
        return __classPrivateFieldGet(this, _Structure_bricks, "f");
    }
    add(brick) {
        brick.structure = this;
        for (const brick of __classPrivateFieldGet(this, _Structure_bricks, "f"))
            brick.events.emit('add-brick', brick);
        __classPrivateFieldGet(this, _Structure_bricks, "f").push(brick);
        this.events.emit('add', brick);
        this.log.info(`Added Brick: ${brick.name}`);
    }
    remove(brick) {
        brick.structure = undefined;
        for (const brick of __classPrivateFieldGet(this, _Structure_bricks, "f"))
            brick.events.emit('remove-brick', brick);
        __classPrivateFieldSet(this, _Structure_bricks, __classPrivateFieldGet(this, _Structure_bricks, "f").filter((b) => b !== brick), "f");
        this.events.emit('remove', brick);
        this.log.info(`Removed Brick: ${brick.name}`);
    }
    get(id) {
        return __classPrivateFieldGet(this, _Structure_bricks, "f").find((b) => b.id === id);
    }
    demolish() {
        for (const brick of __classPrivateFieldGet(this, _Structure_bricks, "f")) {
            brick.events.emit('demolish', this);
            brick.structure = undefined;
        }
        __classPrivateFieldSet(this, _Structure_bricks, [], "f");
        this.log.info('Demolished Structure');
    }
}
_Structure_bricks = new WeakMap();
exports.default = Structure;
