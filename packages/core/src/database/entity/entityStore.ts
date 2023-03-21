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

  load(arg: { schema: Schema }): MaybePromise<void>;
  reset(): MaybePromise<void>;
  teardown(): MaybePromise<void>;

  getEntity(arg: {
    entityName: string;
    id: string | number;
  }): MaybePromise<Entity | null>;

  insertEntity(arg: {
    entityName: string;
    id: string | number;
    instance: Entity;
  }): MaybePromise<Entity>;

  upsertEntity(arg: {
    entityName: string;
    id: string | number;
    instance: Entity;
  }): MaybePromise<Entity>;

  updateEntity(arg: {
    entityName: string;
    id: string | number;
    instance: Partial<Entity>;
  }): MaybePromise<Entity>;

  deleteEntity(arg: {
    entityName: string;
    id: string | number;
  }): MaybePromise<boolean>;

  getEntities(arg: {
    entityName: string;
    filter?: EntityFilter;
  }): MaybePromise<Entity[]>;
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
