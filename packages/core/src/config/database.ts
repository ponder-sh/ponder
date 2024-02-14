import type { PoolConfig } from "pg";

export type DatabaseConfig =
  | { kind: "sqlite"; directory: string }
  | { kind: "postgres"; poolConfig: PoolConfig };
