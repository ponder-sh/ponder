import type { Prettify } from "@/types/utils.js";
import type { PoolConfig as RawPoolConfig } from "pg";

export type PoolConfig = Prettify<RawPoolConfig & { max: number }>;

export type DatabaseConfig =
  | { kind: "pglite"; directory: string }
  | {
      kind: "postgres";
      poolConfig: PoolConfig;
      schema: string;
    };
