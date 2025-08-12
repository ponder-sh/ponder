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

export type PgBigNumberBuilderInitial<TName extends string> =
  PgBigNumberBuilder<{
    name: TName;
    dataType: "custom";
    columnType: "PgEvmBigNumber";
    data: BigNumber;
    driverParam: string;
    enumValues: undefined;
    generated: undefined;
  }>;

export class PgBigNumberBuilder<
  T extends ColumnBuilderBaseConfig<"custom", "PgEvmBigNumber">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgEvmBigNumberBuilder";

  constructor(name: T["name"]) {
    super(name, "custom", "PgEvmBigNumber");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgBigNumber<MakeColumnConfig<T, TTableName>> {
    return new PgBigNumber<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgBigNumber<
  T extends ColumnBaseConfig<"custom", "PgEvmBigNumber">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgEvmBigNumber";

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
