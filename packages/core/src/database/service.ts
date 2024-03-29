import type { Schema } from "@/schema/types.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { PostgresDatabaseService } from "./postgres/service.js";
import { SqliteDatabaseService } from "./sqlite/service.js";

export type FunctionMetadata = {
  functionId: string;
  functionName: string;
  fromCheckpoint: Checkpoint | null;
  toCheckpoint: Checkpoint;
  eventCount: number;
};

export type DatabaseService = PostgresDatabaseService | SqliteDatabaseService;

export interface BaseDatabaseService {
  kind: "sqlite" | "postgres";

  setup({
    schema,
  }: {
    schema: Schema;
  }): Promise<void>;

  revert({ checkpoint }: { checkpoint: Checkpoint }): Promise<void>;

  kill(): Promise<void>;
}
