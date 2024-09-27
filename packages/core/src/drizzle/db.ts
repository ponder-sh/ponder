import { type PgTableFn, pgSchema, pgTable } from "drizzle-orm/pg-core";
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
  primaryKey,
  alias,
  foreignKey,
  union,
  unionAll,
  intersect,
  intersectAll,
  except,
  exceptAll,
} from "drizzle-orm/pg-core";

export const onchainTable: PgTableFn = (name, columns, extraConfig) => {
  const table = pgTable(name, columns, extraConfig);

  /**
   * This trick is used to make `table instanceof PgTable` evaluate to false.
   * This is necessary to avoid generating migrations for onchain tables.
   */
  Object.setPrototypeOf(table, Object.prototype);

  // @ts-ignore
  table[onchain] = true;

  return table;
};

export const offchainSchema = <T extends string>(name: T) => pgSchema(name);
export const offchainTable: PgTableFn = pgTable;
