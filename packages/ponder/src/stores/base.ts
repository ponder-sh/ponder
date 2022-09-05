import type { PonderSchema } from "@/core/schema/types";

import { SqliteStore } from "./sqlite";

export interface BaseStore {
  kind: StoreKind;

  migrate(schema: PonderSchema): Promise<void>;

  getEntity<T>(entityName: string, id: string): Promise<T | null>;

  getEntities<T>(entityName: string, id: string, filter: any): Promise<T[]>;

  insertEntity<T>(
    entityName: string,
    attributes: { id: string } & T
  ): Promise<T>;

  upsertEntity<T>(
    entityName: string,
    attributes: { id: string } & T
  ): Promise<T>;

  deleteEntity(entityName: string, id: string): Promise<void>;
}

export enum StoreKind {
  SQLITE = "sqlite",
}

export type Store = SqliteStore;
