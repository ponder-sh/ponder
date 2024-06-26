import {
  type ColumnBaseConfig,
  type ColumnBuilderBaseConfig,
  type ColumnBuilderRuntimeConfig,
  type MakeColumnConfig,
  entityKind,
} from "drizzle-orm";
import {
  type AnySQLiteTable,
  SQLiteColumn,
  SQLiteColumnBuilder,
} from "drizzle-orm/sqlite-core";

export class SQLiteJsonBuilder<
  T extends ColumnBuilderBaseConfig<"json", "SQLiteJson">,
> extends SQLiteColumnBuilder<T> {
  static readonly [entityKind]: string = "SQliteJsonBuilder";

  constructor(name: T["name"]) {
    super(name, "json", "SQLiteJson");
  }

  /** @internal */
  build<TTableName extends string>(
    table: AnySQLiteTable<{ name: TTableName }>,
  ): SQLiteJson<MakeColumnConfig<T, TTableName>> {
    return new SQLiteJson<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class SQLiteJson<
  T extends ColumnBaseConfig<"json", "SQLiteJson">,
> extends SQLiteColumn<T> {
  static readonly [entityKind]: string = "SQLiteJson";

  getSQLType(): string {
    return "jsonb";
  }

  override mapFromDriverValue(value: string): T["data"] {
    return JSON.parse(value);
  }

  override mapToDriverValue(value: T["data"]): string {
    return JSON.stringify(value);
  }
}
