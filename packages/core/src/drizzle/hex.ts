import { entityKind } from "drizzle-orm";
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

export class PgHexBuilder extends PgColumnBuilder {
  static readonly [entityKind]: string = "PgHexBuilder";

  constructor(columnName: string) {
    super(columnName, "buffer", "PgHex");
  }

  build(table: AnyPgTable) {
    return new PgHex(table, this.config);
  }
}

export class PgHex extends PgColumn {
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

export class SQLiteHexBuilder extends SQLiteColumnBuilder {
  static readonly [entityKind]: string = "SQliteHexBuilder";

  constructor(columnName: string) {
    super(columnName, "buffer", "SQLiteHex");
  }

  build(table: AnySQLiteTable) {
    return new SQLiteHex(table, this.config);
  }
}

export class SQLiteHex extends SQLiteColumn {
  static readonly [entityKind]: string = "SQLiteHex";

  getSQLType(): string {
    return "blob";
  }

  override mapFromDriverValue(value: Buffer) {
    return bytesToHex(value);
  }

  override mapToDriverValue(value: `0x${string}`): Buffer {
    return Buffer.from(hexToBytes(value));
  }
}
