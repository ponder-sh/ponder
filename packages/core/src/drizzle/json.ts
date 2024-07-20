import { entityKind } from "drizzle-orm";
import {
  type AnySQLiteTable,
  SQLiteColumn,
  SQLiteColumnBuilder,
} from "drizzle-orm/sqlite-core";

export class SQLiteJsonBuilder extends SQLiteColumnBuilder {
  static readonly [entityKind]: string = "SQliteJsonBuilder";

  constructor(columnName: string) {
    super(columnName, "json", "SQLiteJson");
  }

  build(table: AnySQLiteTable) {
    return new SQLiteJson(table, this.config);
  }
}

export class SQLiteJson extends SQLiteColumn {
  static readonly [entityKind]: string = "SQLiteJson";

  getSQLType(): string {
    return "jsonb";
  }

  override mapFromDriverValue(value: string) {
    return JSON.parse(value);
  }

  override mapToDriverValue(value: object): string {
    return JSON.stringify(value);
  }
}
