import type { Schema } from "@/schema/common.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import type { PostgresDatabaseService } from "./postgres/service.js";
import type { SqliteDatabaseService } from "./sqlite/service.js";

export type DatabaseService = PostgresDatabaseService | SqliteDatabaseService;

export type NamespaceInfo = {
  userNamespace: string;
  internalNamespace: string;
  internalTableIds: { [tableName: string]: string };
};

export interface BaseDatabaseService {
  kind: "sqlite" | "postgres";

  setup({
    schema,
    buildId,
  }: {
    schema: Schema;
    buildId: string;
  }): Promise<{
    checkpoint: Checkpoint;
    namespaceInfo: NamespaceInfo;
  }>;

  revert({
    checkpoint,
    namespaceInfo,
  }: {
    checkpoint: Checkpoint;
    namespaceInfo: NamespaceInfo;
  }): Promise<void>;

  updateFinalizedCheckpoint({
    checkpoint,
  }: { checkpoint: Checkpoint }): Promise<void>;

  createIndexes({ schema }: { schema: Schema }): Promise<void>;

  kill(): Promise<void>;
}
