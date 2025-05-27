export { createConfig } from "@/config/index.js";
export { factory } from "@/config/address.js";
export type {
  Block,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
export type { Virtual } from "@/types/virtual.js";
export {
  type MergeAbis,
  type ReplaceBigInts,
  mergeAbis,
  loadBalance,
  rateLimit,
  replaceBigInts,
} from "@ponder/utils";

import type { Config } from "@/config/index.js";
import type { Prettify } from "./types/utils.js";

export type ContractConfig = Prettify<Config["contracts"][string]>;
export type ChainConfig = Prettify<Config["chains"][string]>;
export type BlockConfig = Prettify<Config["blocks"][string]>;
export type DatabaseConfig = Prettify<Config["database"]>;

export {
  onchainTable,
  onchainEnum,
  primaryKey,
  hex,
  bigint,
} from "@/drizzle/onchain.js";

export type {
  OnchainTable,
  BuildExtraConfigColumns,
  PgColumnsBuilders,
  PrimaryKeyBuilder,
  OnchainEnum,
} from "@/drizzle/onchain.js";

export type { ReadonlyDrizzle } from "@/types/db.js";

export { client } from "@/client/index.js";

export { graphql } from "@/graphql/middleware.js";

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
  notLike,
  ilike,
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
  bigint as int8,
  boolean,
  char,
  cidr,
  date,
  doublePrecision,
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
  smallint,
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
