import {
  type ColumnBaseConfig,
  type ColumnBuilderBaseConfig,
  type ColumnBuilderRuntimeConfig,
  type MakeColumnConfig,
  entityKind,
} from "drizzle-orm";
import {
  type AnyPgTable,
  PgColumn,
  PgColumnBuilder,
} from "drizzle-orm/pg-core";
import {
  type AnySQLiteTable,
  SQLiteColumn,
  SQLiteColumnBuilder,
} from "drizzle-orm/sqlite-core";
import { bytesToHex, hexToBytes } from "viem";

export class PgHexBuilder<
  T extends ColumnBuilderBaseConfig<"buffer", "PgHex">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgHexBuilder";

  constructor(name: T["name"]) {
    super(name, "buffer", "PgHex");
  }

  /** @internal */
  build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgHex<MakeColumnConfig<T, TTableName>> {
    return new PgHex<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgHex<
  T extends ColumnBaseConfig<"buffer", "PgHex">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgHex";

  getSQLType(): string {
    return "bytea";
  }

  override mapFromDriverValue(value: Buffer): T["data"] {
    return bytesToHex(value);
  }

  override mapToDriverValue(value: T["data"]): Buffer {
    return Buffer.from(hexToBytes(value as `0x${string}`));
  }
}

export class SQLiteHexBuilder<
  T extends ColumnBuilderBaseConfig<"buffer", "SQLiteHex">,
> extends SQLiteColumnBuilder<T> {
  static readonly [entityKind]: string = "SQliteHexBuilder";

  constructor(name: T["name"]) {
    super(name, "buffer", "SQLiteHex");
  }

  /** @internal */
  build<TTableName extends string>(
    table: AnySQLiteTable<{ name: TTableName }>,
  ): SQLiteHex<MakeColumnConfig<T, TTableName>> {
    return new SQLiteHex<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class SQLiteHex<
  T extends ColumnBaseConfig<"buffer", "SQLiteHex">,
> extends SQLiteColumn<T> {
  static readonly [entityKind]: string = "SQLiteHex";

  getSQLType(): string {
    return "blob";
  }

  override mapFromDriverValue(value: Buffer): T["data"] {
    return bytesToHex(value);
  }

  override mapToDriverValue(value: T["data"]): Buffer {
    return Buffer.from(hexToBytes(value as `0x${string}`));
  }
}
