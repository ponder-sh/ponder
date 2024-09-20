import { entityKind } from "drizzle-orm";
import { pgSchema, serial } from "drizzle-orm/pg-core";
import {
  type AnyPgTable,
  PgColumn,
  PgColumnBuilder,
} from "drizzle-orm/pg-core";
import { bytesToHex, hexToBytes } from "viem";

const ponderHex = (columnName: string) => new PgHexBuilder(columnName);

export class PgHexBuilder extends PgColumnBuilder {
  static override readonly [entityKind]: string = "PgHexBuilder";

  constructor(columnName: string) {
    super(columnName, "buffer", "PgHex");
  }

  build(table: AnyPgTable) {
    return new PgHex(table, this.config);
  }
}

export class PgHex extends PgColumn {
  static override readonly [entityKind]: string = "PgHex";

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

export const offchainSchema = pgSchema("offchain");

export const metadata = offchainSchema.table("metadata", {
  id: serial("id").primaryKey(),
  account: ponderHex("account").notNull(),
});
