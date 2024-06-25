import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
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

export class SQLiteBigintBuilder<
  T extends ColumnBuilderBaseConfig<"string", "SQLiteBigint">,
> extends SQLiteColumnBuilder<T> {
  static readonly [entityKind]: string = "SQliteHexBuilder";

  constructor(name: T["name"]) {
    super(name, "string", "SQLiteBigint");
  }

  /** @internal */
  build<TTableName extends string>(
    table: AnySQLiteTable<{ name: TTableName }>,
  ): SQLiteBigint<MakeColumnConfig<T, TTableName>> {
    return new SQLiteBigint<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class SQLiteBigint<
  T extends ColumnBaseConfig<"string", "SQLiteBigint">,
> extends SQLiteColumn<T> {
  static readonly [entityKind]: string = "SQLiteBigint";

  getSQLType(): string {
    return "varchar(79)";
  }

  override mapFromDriverValue(value: string): T["data"] {
    return decodeToBigInt(value);
  }

  override mapToDriverValue(value: T["data"]): string {
    return encodeAsText(value as bigint);
  }
}
