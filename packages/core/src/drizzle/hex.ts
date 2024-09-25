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
import { bytesToHex, hexToBytes } from "viem";

// export class PgHexBuilder extends PgColumnBuilder {
//   static override readonly [entityKind]: string = "PgHexBuilder";

//   constructor(columnName: string) {
//     super(columnName, "buffer", "PgHex");
//   }

//   build(table: AnyPgTable) {
//     return new PgHex(table, this.config);
//   }
// }

// export class PgHex extends PgColumn {
//   static override readonly [entityKind]: string = "PgHex";

//   getSQLType(): string {
//     return "bytea";
//   }

//   override mapFromDriverValue(value: Buffer) {
//     return bytesToHex(value);
//   }

//   override mapToDriverValue(value: `0x${string}`): Buffer {
//     return Buffer.from(hexToBytes(value));
//   }
// }

export type PgHexBuilderInitial<TName extends string> = PgHexBuilder<{
  name: TName;
  dataType: "number";
  columnType: "PgHex";
  data: number;
  driverParam: string | number;
  enumValues: undefined;
  generated: undefined;
}>;

export class PgHexBuilder<
  T extends ColumnBuilderBaseConfig<"number", "PgHex">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgHexBuilder";

  constructor(name: T["name"]) {
    super(name, "number", "PgHex");
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
  T extends ColumnBaseConfig<"number", "PgHex">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgHex";

  getSQLType(): string {
    return "bytea";
  }

  override mapFromDriverValue(value: Buffer) {
    return bytesToHex(value);
  }

  override mapToDriverValue(value: `0x${string}`): Buffer {
    return Buffer.from(hexToBytes(value));
  }
}
