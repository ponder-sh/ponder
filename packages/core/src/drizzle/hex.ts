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

export type PgHexBuilderInitial<TName extends string> = PgHexBuilder<{
  name: TName;
  dataType: "string";
  columnType: "PgHex";
  data: `0x${string}`;
  driverParam: string;
  enumValues: undefined;
  generated: undefined;
}>;

export class PgHexBuilder<
  T extends ColumnBuilderBaseConfig<"string", "PgHex">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgHexBuilder";

  constructor(name: T["name"]) {
    super(name, "string", "PgHex");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgHex<MakeColumnConfig<T, TTableName>> {
    return new PgHex<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgHex<
  T extends ColumnBaseConfig<"string", "PgHex">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgHex";

  getSQLType(): string {
    return "text";
  }

  override mapToDriverValue(value: `0x${string}`) {
    if (value.length % 2 === 0) return value.toLowerCase() as `0x${string}`;
    return `0x0${value.slice(2)}`.toLowerCase() as `0x${string}`;
  }
}
