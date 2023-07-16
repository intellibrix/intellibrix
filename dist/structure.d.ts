/// <reference types="node" />
import EventEmitter from 'events';
import pino from 'pino';
import Brick from './brick';
export type StructureOptions = {
    name?: string;
    logLevel?: pino.Level;
    logJSON?: boolean;
    pinoOptions?: pino.LoggerOptions;
};
export default class Structure {
    #private;
    id: string;
    log: pino.Logger;
    name: string;
    events: EventEmitter;
    constructor(opts?: StructureOptions, bricks?: Brick[]);
    get bricks(): Brick[];
    add(brick: Brick): void;
    remove(brick: Brick): void;
    get(id: string): Brick | undefined;
    demolish(): void;
}
