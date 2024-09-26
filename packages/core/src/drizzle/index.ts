import type { Database } from "@/database/index.js";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { numeric } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { PgHexBuilder, type PgHexBuilderInitial } from "./hex.js";

export const ponderHex = <name extends string>(
  columnName: name,
): PgHexBuilderInitial<name> => new PgHexBuilder(columnName);
export const ponderBigint = <name extends string>(columnName: name) =>
  numeric<name>(columnName, { precision: 78 }).$type<bigint>();

export type Drizzle = NodePgDatabase;

export type Schema = { [name: string]: unknown };

export const createDrizzleDb = (
  database: Pick<Database, "driver">,
): Drizzle => {
  return drizzle(database.driver.user as Pool);
};
