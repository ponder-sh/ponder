import type { Schema } from "@/schema/types";

import { PonderDatabase } from "../db";
import { PostgresEntityStore } from "./postgresEntityStore";
import { SqliteEntityStore } from "./sqliteEntityStore";

export type EntityFilter = {
  where?: {
    [key: string]:
      | number
      | string
      | number[]
      | string[]
      | true
      | false
      | undefined
      | null;
  };
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

type Entity = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

export interface EntityStore {
  schema?: Schema;

  load(schema?: Schema): MaybePromise<void>;
  teardown(): MaybePromise<void>;

  getEntity(entityId: string, id: string): MaybePromise<Entity | null>;

  insertEntity(
    entityId: string,
    id: string,
    instance: Entity
  ): MaybePromise<Entity>;

  upsertEntity(
    entityId: string,
    id: string,
    instance: Entity
  ): MaybePromise<Entity>;

  updateEntity(
    entityId: string,
    id: string,
    instance: Partial<Entity>
  ): MaybePromise<Entity>;

  deleteEntity(entityId: string, id: string): MaybePromise<boolean>;

  getEntities(entityId: string, filter?: EntityFilter): MaybePromise<Entity[]>;

  getEntityDerivedField(
    entityId: string,
    id: string,
    derivedFieldName: string
  ): MaybePromise<unknown[]>;
}

export const buildEntityStore = ({
  database,
}: {
  database: PonderDatabase;
}) => {
  switch (database.kind) {
    case "sqlite": {
      return new SqliteEntityStore({ db: database.db });
    }
    case "postgres": {
      return new PostgresEntityStore({ pool: database.pool });
    }
  }
};
