import type { Schema } from "@/schema/types.js";
import { PostgresDatabaseService } from "./postgres/service.js";
import { SqliteDatabaseService } from "./sqlite/service.js";

export type PonderIndexingSchema = {
  "ponder.logs": {
    id: number;
    tableName: string;
    row: string;
    checkpoint: string;
    operation: 0 | 1 | 2;
  };
} & {
  [table: string]: {
    id: unknown;
    [column: string]: unknown;
  };
};

export type DatabaseService = PostgresDatabaseService | SqliteDatabaseService;

export interface BaseDatabaseService {
  kind: "sqlite" | "postgres";

  setup({
    schema,
  }: {
    schema: Schema;
  }): Promise<void>;

  kill(): Promise<void>;
}
