import type { Prettify } from "@/types/utils.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { PGlite } from "@electric-sql/pglite";
import type { PoolConfig as RawPoolConfig } from "pg";

export type PoolConfig = Prettify<RawPoolConfig & { max: number }>;

export type DatabaseConfig =
  | { kind: "pglite"; options: PGliteOptions }
  | { kind: "pglite_test"; instance: PGlite }
  | { kind: "postgres"; poolConfig: PoolConfig };
