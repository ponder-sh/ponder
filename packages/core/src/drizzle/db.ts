import type { Column, SQLWrapper, SelectedFields, Table } from "drizzle-orm";
import type { SelectBuilder } from "./select.js";

export type DrizzleDb = {
  select(): SelectBuilder<undefined, "async", void>;
  select<TSelection extends SelectedFields<Column, Table>>(
    fields: TSelection,
  ): SelectBuilder<TSelection, "async", void>;
  select(
    fields?: SelectedFields<Column, Table>,
  ): SelectBuilder<SelectedFields<Column, Table> | undefined, "async", void>;
  /**
   * Execute a raw read-only SQL query..
   *
   * @example
   * import { ponder } from "@/generated";
   * import { sql } from "@ponder/core";
   *
   * ponder.get("/", async (c) => {
   *   const result = await c.db.execute(sql`SELECT * from "Accounts"`);
   *   return c.json(result);
   * });
   *
   * @see https://orm.drizzle.team/docs/sql
   */
  execute: <record extends Record<string, unknown>>(
    query: SQLWrapper,
  ) => Promise<record[]>;
};
