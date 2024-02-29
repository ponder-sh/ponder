import type {
  FunctionIds,
  TableIds,
} from "@/build/static/getFunctionAndTableIds.js";
import type { TableAccess } from "@/build/static/getTableAccess.js";
import type { Schema } from "@/schema/types.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { PostgresDatabaseService } from "./postgres/service.js";
import { SqliteDatabaseService } from "./sqlite/service.js";

export type Metadata = {
  functionId: string;
  fromCheckpoint: Checkpoint | null;
  toCheckpoint: Checkpoint;
  eventCount: number;
};

export type DatabaseService = PostgresDatabaseService | SqliteDatabaseService;

export interface BaseDatabaseService {
  kind: "sqlite" | "postgres";

  metadata: Metadata[];

  setup(): Promise<void>;

  reset({
    schema,
    tableIds,
    functionIds,
    tableAccess,
  }: {
    schema: Schema;
    tableIds: TableIds;
    functionIds: FunctionIds;
    tableAccess: TableAccess;
  }): Promise<void>;

  kill(): Promise<void>;

  flush(metadata: Metadata[]): Promise<void>;

  publish(): Promise<void>;
}
