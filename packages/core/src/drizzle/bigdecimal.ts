import { BigNumber } from "bignumber.js";
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

export type PgBigDecimalBuilderInitial<TName extends string> =
  PgBigDecimalBuilder<{
    name: TName;
    dataType: "custom";
    columnType: "PgEvmBigDecimal";
    data: BigNumber;
    driverParam: string;
    enumValues: undefined;
    generated: undefined;
  }>;

export class PgBigDecimalBuilder<
  T extends ColumnBuilderBaseConfig<"custom", "PgEvmBigDecimal">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgEvmBigDecimalBuilder";

  constructor(name: T["name"]) {
    super(name, "custom", "PgEvmBigDecimal");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgBigDecimal<MakeColumnConfig<T, TTableName>> {
    return new PgBigDecimal<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgBigDecimal<
  T extends ColumnBaseConfig<"custom", "PgEvmBigDecimal">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgEvmBigDecimal";

  getSQLType(): string {
    return "decimal";
  }

  override mapFromDriverValue(value: string): BigNumber {
    return new BigNumber(value);
  }

  override mapToDriverValue(value: BigNumber): string {
    return value.toFixed();
  }
}
