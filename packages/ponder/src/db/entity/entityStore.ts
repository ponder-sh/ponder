import type { PonderDatabase } from "@/db/db";
import type { PonderSchema } from "@/schema/types";

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

export interface EntityStore {
  migrate(schema: PonderSchema): Promise<void>;

  getEntity<T>(entityName: string, id: string): Promise<T | null>;

  getEntities<T>(entityName: string, filter?: EntityFilter): Promise<T[]>;

  getEntityDerivedField(
    entityName: string,
    id: string,
    derivedFieldName: string
  ): Promise<unknown[]>;

  insertEntity<T>(entityName: string, attributes: T): Promise<T>;

  updateEntity<T>(
    entityName: string,
    attributes: { id: string } & Partial<T>
  ): Promise<T>;

  deleteEntity(entityName: string, id: string): Promise<void>;
}

export const buildEntityStore = (database: PonderDatabase) => {
  switch (database.kind) {
    case "sqlite": {
      return new SqliteEntityStore(database.db);
    }
    case "postgres": {
      return new PostgresEntityStore(database.pgp, database.db);
    }
  }
};
