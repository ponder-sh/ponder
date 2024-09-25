import type { Database } from "@/database/index.js";

import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { numeric } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { PgHexBuilder } from "./hex.js";

export const ponderHex = (columnName: string) => new PgHexBuilder(columnName);
export const ponderBigint = (columnName: string) =>
  numeric(columnName, { precision: 78 });

export type Drizzle = NodePgDatabase;

export const createDrizzleDb = (
  database: Pick<Database, "driver">,
): Drizzle => {
  return drizzle(database.driver.user as Pool);
};
