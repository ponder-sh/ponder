import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";

export const onchain = Symbol.for("ponder:onchain");

export type Drizzle<TSchema extends Schema = NoSchema> =
  | NodePgDatabase<TSchema>
  | PgliteDatabase<TSchema>;

export type Schema = { [name: string]: unknown };
type NoSchema = { [name: string]: never };
