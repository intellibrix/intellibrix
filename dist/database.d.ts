import { Sequelize } from 'sequelize';
export type Service = 'memory' | 'sql';
export type DatabaseOptions = {
    service?: Service;
    uri?: string;
};
export interface KeyValueInterface {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    delete: (key: string) => Promise<boolean>;
    dump: () => Promise<any>;
    load: (data: any) => Promise<void>;
}
export interface SQLInterface {
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    query: (query: string, params?: unknown[]) => Promise<any>;
}
export type DatabaseInterface = KeyValueInterface | SQLInterface;
export default class Database {
    #private;
    service: Service;
    interface?: DatabaseInterface;
    sequelize?: Sequelize;
    memory: any;
    constructor(opts?: DatabaseOptions);
}
