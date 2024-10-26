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

export type PgEvmBigintBuilderInitial<TName extends string> =
  PgEvmBigintBuilder<{
    name: TName;
    dataType: "bigint";
    columnType: "PgEvmBigint";
    data: bigint;
    driverParam: string;
    enumValues: undefined;
    generated: undefined;
  }>;

export class PgEvmBigintBuilder<
  T extends ColumnBuilderBaseConfig<"bigint", "PgEvmBigint">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgEvmBigintBuilder";

  constructor(name: T["name"]) {
    super(name, "bigint", "PgEvmBigint");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgEvmBigint<MakeColumnConfig<T, TTableName>> {
    return new PgEvmBigint<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgEvmBigint<
  T extends ColumnBaseConfig<"bigint", "PgEvmBigint">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgEvmBigint";

  getSQLType(): string {
    return "numeric(78)";
  }

  override mapFromDriverValue(value: string): bigint {
    if (typeof value === "string") return BigInt(value);
    return value;
  }
}
