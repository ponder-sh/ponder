import type { PonderSchema } from "@/core/schema/types";

import type { SqliteEntityStore } from "./sqliteEntityStore";

export type EntityFilter = {
  where?: {
    [key: string]: number | string | number[] | string[];
  };
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

export interface BaseEntityStore {
  kind: StoreKind;

  migrate(schema: PonderSchema): Promise<void>;

  getEntity<T>(entityName: string, id: string): Promise<T | null>;

  getEntities<T>(entityName: string, filter?: EntityFilter): Promise<T[]>;

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

export type EntityStore = SqliteEntityStore;
