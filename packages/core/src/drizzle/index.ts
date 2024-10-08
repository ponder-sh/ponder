import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  PgDatabase as _PgDatabase,
  PgDeleteBase as _PgDeleteBase,
  PgInsertBase as _PgInsertBase,
  PgInsertBuilder as _PgInsertBuilder,
  PgUpdateBase as _PgUpdateBase,
  PgUpdateBuilder as _PgUpdateBuilder,
} from "drizzle-orm/pg-core";

export const onchain = Symbol.for("ponder:onchain");

export type Drizzle<TSchema extends Schema = NoSchema> =
  NodePgDatabase<TSchema>;

export type Schema = { [name: string]: unknown };
type NoSchema = { [name: string]: never };
