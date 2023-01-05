import type { Ponder } from "@/Ponder";
import type { Schema } from "@/schema/types";

import { PostgresEntityStore } from "./postgresEntityStore";
import { SqliteEntityStore } from "./sqliteEntityStore";

export type EntityFilter = {
  where?: {
    [key: string]: number | string | number[] | string[];
  };
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

type Entity = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

export interface EntityStore {
  migrate(schema: Schema): MaybePromise<void>;

  getEntity(entityName: string, id: string): MaybePromise<Entity | null>;

  insertEntity(
    entityName: string,
    id: string,
    instance: Entity
  ): MaybePromise<Entity>;

  upsertEntity(
    entityName: string,
    id: string,
    instance: Entity
  ): MaybePromise<Entity>;

  updateEntity(
    entityName: string,
    id: string,
    instance: Partial<Entity>
  ): MaybePromise<Entity>;

  deleteEntity(entityName: string, id: string): MaybePromise<boolean>;

  getEntities(
    entityName: string,
    filter?: EntityFilter
  ): MaybePromise<Entity[]>;

  getEntityDerivedField(
    entityName: string,
    id: string,
    derivedFieldName: string
  ): MaybePromise<unknown[]>;
}

export const buildEntityStore = ({ ponder }: { ponder: Ponder }) => {
  switch (ponder.database.kind) {
    case "sqlite": {
      return new SqliteEntityStore({ db: ponder.database.db, ponder });
    }
    case "postgres": {
      return new PostgresEntityStore({ db: ponder.database.db });
    }
  }
};
