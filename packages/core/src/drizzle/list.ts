import type { Scalar } from "@/schema/common.js";
import { entityKind } from "drizzle-orm";
import {
  type AnyPgTable,
  PgColumn,
  PgColumnBuilder,
} from "drizzle-orm/pg-core";

export class PgListBuilder extends PgColumnBuilder {
  static readonly [entityKind]: string = "PgListBuilder";
  element: Scalar;

  constructor(columnName: string, element: Scalar) {
    super(columnName, "string", "PgList");
    this.element = element;
  }

  build(table: AnyPgTable) {
    return new PgList(table, this.config, this.element);
  }
}

export class PgList extends PgColumn {
  static readonly [entityKind]: string = "PgList";
  element: Scalar;

  constructor(
    table: AnyPgTable,
    config: PgListBuilder["config"],
    element: Scalar,
  ) {
    super(table, config);
    this.element = element;
  }

  getSQLType(): string {
    return "text";
  }

  override mapFromDriverValue(value: string) {
    return this.element === "bigint"
      ? JSON.parse(value).map(BigInt)
      : JSON.parse(value);
  }

  override mapToDriverValue(value: Array<unknown>): string {
    return this.element === "bigint"
      ? JSON.stringify(value.map(String))
      : JSON.stringify(value);
  }
}
