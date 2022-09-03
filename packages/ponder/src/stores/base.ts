import { SqliteStore } from "./sqlite";

export interface BaseStore {
  kind: StoreKind;

  migrate(): Promise<void>;

  getEntity(key: string, id: string): Promise<any>;

  getEntities(key: string, id: string, filter: any): Promise<any>;

  setEntity(key: string, id: string, attributes: any): Promise<any>;

  removeEntity(key: string, id: string): Promise<void>;
}

export enum StoreKind {
  SQLITE = "sqlite",
}

export type Store = SqliteStore;
