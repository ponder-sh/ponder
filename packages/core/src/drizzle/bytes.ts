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

export type PgBytesBuilderInitial<TName extends string> = PgBytesBuilder<{
  name: TName;
  dataType: "buffer";
  columnType: "PgBytes";
  data: Uint8Array;
  driverParam: string;
  enumValues: undefined;
  generated: undefined;
}>;

export class PgBytesBuilder<
  T extends ColumnBuilderBaseConfig<"buffer", "PgBytes">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgBytesBuilder";

  constructor(name: T["name"]) {
    super(name, "buffer", "PgBytes");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgBytes<MakeColumnConfig<T, TTableName>> {
    return new PgBytes<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }

  /**
   * @deprecated Bytes columns cannot be used as arrays
   */
  override array(): never {
    throw new Error("bytes().array() is not supported");
  }
}

export class PgBytes<
  T extends ColumnBaseConfig<"buffer", "PgBytes">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgBytes";

  getSQLType(): string {
    return "bytea";
  }

  override mapFromDriverValue(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  }

  override mapToDriverValue(value: Uint8Array): Buffer {
    return Buffer.from(value);
  }
}
