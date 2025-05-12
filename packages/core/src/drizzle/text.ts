import {
  type ColumnBaseConfig,
  type ColumnBuilderBaseConfig,
  type ColumnBuilderRuntimeConfig,
  type MakeColumnConfig,
  entityKind,
  getTableName,
} from "drizzle-orm";
import {
  type AnyPgTable,
  PgColumn,
  PgColumnBuilder,
  type PgTextConfig,
} from "drizzle-orm/pg-core";

export type PgTextBuilderInitial<
  TName extends string,
  TEnum extends [string, ...string[]],
> = PgTextBuilder<{
  name: TName;
  dataType: "string";
  columnType: "PgText";
  data: TEnum[number];
  enumValues: TEnum;
  driverParam: string;
}>;

export class PgTextBuilder<
  T extends ColumnBuilderBaseConfig<"string", "PgText">,
> extends PgColumnBuilder<T, { enumValues: T["enumValues"] }> {
  static override readonly [entityKind]: string = "PgTextBuilder";

  constructor(name: T["name"], config: PgTextConfig<T["enumValues"]>) {
    super(name, "string", "PgText");
    this.config.enumValues = config.enum;
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgText<MakeColumnConfig<T, TTableName>> {
    return new PgText<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgText<
  T extends ColumnBaseConfig<"string", "PgText">,
> extends PgColumn<T, { enumValues: T["enumValues"] }> {
  static override readonly [entityKind]: string = "PgText";

  override readonly enumValues = this.config.enumValues;

  getSQLType(): string {
    return "text";
  }

  override mapToDriverValue(value: string) {
    // Note: swallow errors because drizzle will throw a more specific error if the value is invalid
    try {
      if (value.match(/\0/g)) {
        globalThis.PONDER_COMMON?.logger.warn({
          service: "indexing",
          msg: `Detected and removed null byte characters from the string '${value}' inserted into the ${getTableName(this.table)}.${this.name} column. Postgres "text" columns do not support null byte characters. Please consider handling this case in your indexing logic.`,
        });

        return value.replace(/\0/g, "");
      }
    } catch {}
    return value;
  }
}
