import type { BuildColumns, ColumnBuilderBase } from "drizzle-orm";
import {
  type AnyPgColumn,
  type ExtraConfigColumn,
  type PgColumnBuilderBase,
  type PgTable,
  type PgTableExtraConfig,
  type TableConfig,
  pgSchema,
  pgTable,
} from "drizzle-orm/pg-core";
import { numeric } from "drizzle-orm/pg-core";
import { PgHexBuilder, type PgHexBuilderInitial } from "./hex.js";
import { onchain } from "./index.js";

export const evmHex = <name extends string>(
  columnName: name,
): PgHexBuilderInitial<name> => new PgHexBuilder(columnName);
export const evmBigint = <name extends string>(columnName: name) =>
  numeric<name>(columnName, { precision: 78 }).$type<bigint>();

export {
  sql,
  eq,
  gt,
  gte,
  lt,
  lte,
  ne,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  exists,
  notExists,
  between,
  notBetween,
  like,
  notIlike,
  not,
  asc,
  desc,
  and,
  or,
  count,
  countDistinct,
  avg,
  avgDistinct,
  sum,
  sumDistinct,
  max,
  min,
  relations,
} from "drizzle-orm";

export {
  bigserial,
  boolean,
  char,
  cidr,
  date,
  doublePrecision,
  pgEnum,
  inet,
  integer,
  interval,
  json,
  jsonb,
  line,
  macaddr,
  macaddr8,
  numeric,
  point,
  real,
  serial,
  smallint,
  smallserial,
  text,
  time,
  timestamp,
  uuid,
  varchar,
  index,
  uniqueIndex,
  alias,
  foreignKey,
  union,
  unionAll,
  intersect,
  intersectAll,
  except,
  exceptAll,
} from "drizzle-orm/pg-core";

import {
  type PrimaryKeyBuilder as DrizzlePrimaryKeyBuilder,
  primaryKey as drizzlePrimaryKey,
} from "drizzle-orm/pg-core";

export type PrimaryKeyBuilder<columnNames extends string = string> =
  DrizzlePrimaryKeyBuilder & { columnNames: columnNames };

export const primaryKey = <
  tableName extends string,
  column extends AnyPgColumn<{ tableName: tableName }> & { " name": string },
  columns extends (AnyPgColumn<{ tableName: tableName }> & {
    " name": string;
  })[],
>({
  name,
  columns,
}: { name?: string; columns: [column, ...columns] }) =>
  drizzlePrimaryKey({ name, columns }) as PrimaryKeyBuilder<
    column[" name"] | columns[number][" name"]
  >;

export type OnchainTable<
  T extends TableConfig & {
    extra: PgTableExtraConfig | undefined;
  } = TableConfig & { extra: PgTableExtraConfig | undefined },
> = PgTable<T> & {
  [Key in keyof T["columns"]]: T["columns"][Key];
} & { [onchain]: true };

export type OffchainTable<T extends TableConfig> = PgTable<T> & {
  [Key in keyof T["columns"]]: T["columns"][Key];
};

type BuildExtraConfigColumns<
  columns extends Record<string, ColumnBuilderBase>,
> = {
  [key in keyof columns]: ExtraConfigColumn & {
    " name": columns[key]["_"]["name"];
  };
};

/**
 * Create an onchain table
 *
 * @returns The offchain table.
 */
export const onchainTable = <
  name extends string,
  columns extends Record<string, PgColumnBuilderBase>,
  extra extends PgTableExtraConfig | undefined = undefined,
>(
  name: name,
  columns: columns,
  extraConfig?: (self: BuildExtraConfigColumns<columns>) => extra,
): OnchainTable<{
  name: name;
  schema: undefined;
  columns: BuildColumns<name, columns, "pg">;
  extra: extra;
  dialect: "pg";
}> => {
  // @ts-ignore
  const table = pgTable(name, columns, extraConfig);

  /**
   * This trick is used to make `table instanceof PgTable` evaluate to false.
   * This is necessary to avoid generating migrations for onchain tables.
   */
  Object.setPrototypeOf(table, Object.prototype);

  // @ts-ignore
  table[onchain] = true;

  // @ts-ignore
  return table;
};

export const offchainSchema = <T extends string>(name: T) => pgSchema(name);

/**
 * Create an offchain table
 *
 * @returns The offchain table.
 */
export const offchainTable = <
  name extends string,
  columns extends Record<string, PgColumnBuilderBase>,
>(
  name: name,
  columns: columns,
  extraConfig?: (self: BuildExtraConfigColumns<columns>) => PgTableExtraConfig,
): OffchainTable<{
  name: name;
  schema: undefined;
  columns: BuildColumns<name, columns, "pg">;
  dialect: "pg";
  // @ts-ignore
}> => pgTable(name, columns, extraConfig);
