import type { PonderSchema } from "@/core/schema/types";

import { SqliteStore } from "./sqlite";

export interface BaseStore {
  kind: StoreKind;

  migrate(schema: PonderSchema): Promise<void>;

  getEntity<T>(entity: string, id: string): Promise<T | null>;

  getEntities<T>(entity: string, id: string, filter: any): Promise<T[]>;

  insertEntity<T>(entity: string, attributes: { id: string } & T): Promise<T>;

  upsertEntity<T>(entity: string, attributes: { id: string } & T): Promise<T>;

  removeEntity(entity: string, id: string): Promise<void>;
}

export enum StoreKind {
  SQLITE = "sqlite",
}

export type Store = SqliteStore;
