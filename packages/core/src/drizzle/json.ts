import { BigIntSerializationError, getBaseError } from "@/internal/errors.js";
import { type ColumnBaseConfig, entityKind } from "drizzle-orm";
import type {
  ColumnBuilderBaseConfig,
  ColumnBuilderRuntimeConfig,
  MakeColumnConfig,
} from "drizzle-orm/column-builder";
import {
  type AnyPgTable,
  PgColumn,
  PgColumnBuilder,
} from "drizzle-orm/pg-core";

export type PgJsonBuilderInitial<TName extends string> = PgJsonBuilder<{
  name: TName;
  dataType: "json";
  columnType: "PgJson";
  data: unknown;
  driverParam: string;
  enumValues: undefined;
}>;

export class PgJsonBuilder<
  T extends ColumnBuilderBaseConfig<"json", "PgJson">,
> extends PgColumnBuilder<T> {
  static readonly [entityKind]: string = "PgJsonBuilder";

  constructor(name: T["name"]) {
    super(name, "json", "PgJson");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgJson<MakeColumnConfig<T, TTableName>> {
    return new PgJson<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgJson<
  T extends ColumnBaseConfig<"json", "PgJson">,
> extends PgColumn<T> {
  static readonly [entityKind]: string = "PgJson";

  getSQLType(): string {
    return "json";
  }

  override mapToDriverValue(value: T["data"]): string {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      let error = getBaseError(_error);
      if (error?.message?.includes("Do not know how to serialize a BigInt")) {
        error = new BigIntSerializationError(error.message);
        error.meta.push(
          "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
        );
      }

      throw error;
    }
  }

  override mapFromDriverValue(value: T["data"] | string): T["data"] {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value as T["data"];
      }
    }
    return value;
  }
}

export type PgJsonbBuilderInitial<TName extends string> = PgJsonbBuilder<{
  name: TName;
  dataType: "json";
  columnType: "PgJsonb";
  data: unknown;
  driverParam: unknown;
  enumValues: undefined;
}>;

export class PgJsonbBuilder<
  T extends ColumnBuilderBaseConfig<"json", "PgJsonb">,
> extends PgColumnBuilder<T> {
  static override readonly [entityKind]: string = "PgJsonbBuilder";

  constructor(name: T["name"]) {
    super(name, "json", "PgJsonb");
  }

  /** @internal */
  // @ts-ignore
  override build<TTableName extends string>(
    table: AnyPgTable<{ name: TTableName }>,
  ): PgJsonb<MakeColumnConfig<T, TTableName>> {
    return new PgJsonb<MakeColumnConfig<T, TTableName>>(
      table,
      this.config as ColumnBuilderRuntimeConfig<any, any>,
    );
  }
}

export class PgJsonb<
  T extends ColumnBaseConfig<"json", "PgJsonb">,
> extends PgColumn<T> {
  static override readonly [entityKind]: string = "PgJsonb";

  // biome-ignore lint/complexity/noUselessConstructor: <explanation>
  constructor(
    table: AnyPgTable<{ name: T["tableName"] }>,
    config: PgJsonbBuilder<T>["config"],
  ) {
    super(table, config);
  }

  getSQLType(): string {
    return "jsonb";
  }

  override mapToDriverValue(value: T["data"]): string {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      let error = getBaseError(_error);
      if (error?.message?.includes("Do not know how to serialize a BigInt")) {
        error = new BigIntSerializationError(error.message);
        error.meta.push(
          "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
        );
      }

      throw error;
    }
  }

  override mapFromDriverValue(value: T["data"] | string): T["data"] {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value as T["data"];
      }
    }
    return value;
  }
}
