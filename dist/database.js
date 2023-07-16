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
var _Database_uri;
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
class Database {
    constructor(opts) {
        _Database_uri.set(this, void 0);
        this.service = (opts === null || opts === void 0 ? void 0 : opts.service) || 'memory';
        __classPrivateFieldSet(this, _Database_uri, opts === null || opts === void 0 ? void 0 : opts.uri, "f");
        switch (this.service) {
            case 'memory':
                const memoryInterface = {
                    get: async (key) => this.memory[key],
                    set: async (key, value) => this.memory[key] = value,
                    delete: async (key) => delete this.memory[key],
                    dump: async () => this.memory,
                    load: async (data) => this.memory = data
                };
                this.memory = {};
                this.interface = memoryInterface;
                break;
            case 'sql':
                if (!__classPrivateFieldGet(this, _Database_uri, "f"))
                    break;
                this.sequelize = new sequelize_1.Sequelize(__classPrivateFieldGet(this, _Database_uri, "f"), { logging: false });
                this.interface = {
                    connect: async () => { var _a; return (_a = this.sequelize) === null || _a === void 0 ? void 0 : _a.authenticate(); },
                    disconnect: async () => { var _a; return (_a = this.sequelize) === null || _a === void 0 ? void 0 : _a.close(); },
                    query: async (query, values) => { var _a; return (_a = this.sequelize) === null || _a === void 0 ? void 0 : _a.query({ query, values: values }); }
                };
                break;
            default:
                throw new Error('Invalid service');
        }
    }
}
_Database_uri = new WeakMap();
exports.default = Database;
