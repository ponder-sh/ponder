import type { Prettify } from "@/types/utils.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { PoolConfig as RawPoolConfig } from "pg";

export type PoolConfig = Prettify<RawPoolConfig & { max: number }>;

export type DatabaseConfig =
  | { kind: "pglite"; options: PGliteOptions }
  | { kind: "postgres"; poolConfig: PoolConfig; schema: string };
