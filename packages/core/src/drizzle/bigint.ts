import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import { entityKind } from "drizzle-orm";
import {
  type AnySQLiteTable,
  SQLiteColumn,
  SQLiteColumnBuilder,
} from "drizzle-orm/sqlite-core";

export class SQLiteBigintBuilder extends SQLiteColumnBuilder {
  static readonly [entityKind]: string = "SQliteBigintBuilder";

  constructor(columnName: string) {
    super(columnName, "string", "SQLiteBigint");
  }

  build(table: AnySQLiteTable) {
    return new SQLiteBigint(table, this.config);
  }
}

export class SQLiteBigint extends SQLiteColumn {
  static readonly [entityKind]: string = "SQLiteBigint";

  getSQLType(): string {
    return "varchar(79)";
  }

  override mapFromDriverValue(value: string) {
    return decodeToBigInt(value);
  }

  override mapToDriverValue(value: bigint): string {
    return encodeAsText(value as bigint);
  }
}
