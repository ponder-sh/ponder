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

export type EntityInstance = Record<string, unknown> & {
  id: string | number | bigint;
};

type MaybePromise<T> = T | Promise<T>;

export interface EntityStore {
  schema?: Schema;

  load(arg: { schema: Schema }): MaybePromise<void>;
  reset(): MaybePromise<void>;
  teardown(): MaybePromise<void>;

  findUniqueEntity(arg: {
    entityName: string;
    id: string | number | bigint;
  }): Promise<EntityInstance | null>;

  createEntity(arg: {
    entityName: string;
    id: string | number | bigint;
    data: Omit<EntityInstance, "id">;
  }): Promise<EntityInstance>;

  updateEntity(arg: {
    entityName: string;
    id: string | number | bigint;
    data: Omit<Partial<EntityInstance>, "id">;
  }): Promise<EntityInstance>;

  upsertEntity(arg: {
    entityName: string;
    id: string | number | bigint;
    create: Omit<EntityInstance, "id">;
    update: Omit<Partial<EntityInstance>, "id">;
  }): Promise<EntityInstance>;

  deleteEntity(arg: {
    entityName: string;
    id: string | number | bigint;
  }): Promise<boolean>;

  getEntities(arg: {
    entityName: string;
    filter?: EntityFilter;
  }): Promise<EntityInstance[]>;
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
