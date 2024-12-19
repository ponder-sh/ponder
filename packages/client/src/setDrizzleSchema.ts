import { Table, is } from "drizzle-orm";

const Schema = Symbol.for("drizzle:Schema");

export const setDrizzleSchema = <T extends { [name: string]: unknown }>(
  schema: T,
  schemaName: string,
): T => {
  for (const table of Object.values(schema)) {
    if (is(table, Table)) {
      // @ts-ignore
      table[Schema] = schemaName;
    }
  }
  return schema;
};
