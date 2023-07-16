/// <reference types="node" />
import EventEmitter from 'events';
import pino from 'pino';
import Database from './database';
import Intelligence from './intelligence';
import Structure from './structure';
export type Program = {
    name: string;
    description?: string;
    steps: Step[];
};
export type Step = {
    name?: string;
    description?: string;
    actions: Action[];
};
export type Action = {
    name?: string;
    description?: string;
    method: (payload: any, brick: Brick) => Promise<any>;
};
export type BrickOptions = {
    id?: string;
    name?: string;
    logLevel?: pino.Level;
    logJSON?: boolean;
    pinoOptions?: pino.LoggerOptions;
    structure?: Structure;
    intelligence?: Intelligence;
    database?: Database;
};
export default class Brick {
    #private;
    id: string;
    ai?: Intelligence;
    db?: Database;
    log: pino.Logger;
    name: string;
    structure?: Structure;
    events: EventEmitter;
    constructor(opts?: BrickOptions);
    get programs(): {
        [key: string]: Program;
    };
    run(name: string, payload: any): Promise<any>;
    program(program: Program): void;
    deprogram(name: string): void;
}
