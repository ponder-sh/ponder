import type { Schema } from "@/schema/types.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { PostgresDatabaseService } from "./postgres/service.js";
import { SqliteDatabaseService } from "./sqlite/service.js";

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
    appId,
  }: {
    schema: Schema;
    appId: string;
  }): Promise<{
    checkpoint: Checkpoint;
    namespaceInfo: NamespaceInfo;
  }>;

  kill(): Promise<void>;
}
