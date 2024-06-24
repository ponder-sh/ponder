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
  execute: <record extends Record<string, unknown>>(
    query: SQLWrapper,
  ) => record[];
};
