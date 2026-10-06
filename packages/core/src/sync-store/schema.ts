import {
  customType,
  index,
  pgSchema,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import type { Address, Hash, Hex } from "viem";
import type { FactoryFragmentId, FragmentId } from "@/internal/types.js";

const nummultirange = customType<{ data: string }>({
  dataType() {
    return "nummultirange";
  },
});

const numeric78 = customType<{ data: bigint; driverData: string }>({
  dataType() {
    return "numeric(78,0)";
  },
  fromDriver(value: string) {
    return BigInt(value);
  },
});

/**
 * Database schemas for the sync.
 *
 * @dev The order of the schemas represents the order of the migrations.
 * @dev Each schema after the first must have a directory in "./sql" with
 * "create.sql" and "copy.sql".
 *
 * @dev The first schema is the legacy "ponder_sync" schema. Ponder no longer
 * creates it, and only copies data from it.
 */
export const PONDER_SYNC_SCHEMAS = ["ponder_sync", "ponder_sync_1"] as const;
/**
 * Latest database schema for the sync.
 */
export const PONDER_SYNC_SCHEMA =
  PONDER_SYNC_SCHEMAS[PONDER_SYNC_SCHEMAS.length - 1]!;

export const PONDER_SYNC = pgSchema(PONDER_SYNC_SCHEMA);

export const blocks = PONDER_SYNC.table(
  "blocks",
  (t) => ({
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    number: t.bigint({ mode: "bigint" }).notNull(),
    timestamp: t.bigint({ mode: "bigint" }).notNull(),
    hash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    parentHash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    logsBloom: t.varchar({ length: 514 }).notNull().$type<Hex>(),
    miner: t.varchar({ length: 42 }).notNull().$type<Address>(),
    gasUsed: numeric78().notNull(),
    gasLimit: numeric78().notNull(),
    baseFeePerGas: numeric78(),
    nonce: t.varchar({ length: 18 }).$type<Hex>(),
    mixHash: t.varchar({ length: 66 }).$type<Hash>(),
    stateRoot: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    receiptsRoot: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    transactionsRoot: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    sha3Uncles: t.varchar({ length: 66 }).$type<Hash>(),
    size: numeric78().notNull(),
    difficulty: numeric78().notNull(),
    totalDifficulty: numeric78(),
    extraData: t.text().notNull().$type<Hex>(),
  }),
  (table) => [
    primaryKey({
      name: "blocks_pkey",
      columns: [table.chainId, table.number],
    }),
  ],
);

export const transactions = PONDER_SYNC.table(
  "transactions",
  (t) => ({
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    blockNumber: t.bigint({ mode: "bigint" }).notNull(),
    transactionIndex: t.integer().notNull(),
    hash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    blockHash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    from: t.varchar({ length: 42 }).notNull().$type<Address>(),
    to: t.varchar({ length: 42 }).$type<Address>(),
    input: t.text().notNull().$type<Hex>(),
    value: numeric78().notNull(),
    nonce: t.integer().notNull(),
    r: t.varchar({ length: 66 }).$type<Hex>(),
    s: t.varchar({ length: 66 }).$type<Hex>(),
    v: numeric78(),
    type: t.text().notNull().$type<Hex>(),
    gas: numeric78().notNull(),
    gasPrice: numeric78(),
    maxFeePerGas: numeric78(),
    maxPriorityFeePerGas: numeric78(),
    accessList: t.text(),
  }),
  (table) => [
    primaryKey({
      name: "transactions_pkey",
      columns: [table.chainId, table.blockNumber, table.transactionIndex],
    }),
  ],
);

export const transactionReceipts = PONDER_SYNC.table(
  "transaction_receipts",
  (t) => ({
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    blockNumber: t.bigint({ mode: "bigint" }).notNull(),
    transactionIndex: t.integer().notNull(),
    transactionHash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    blockHash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    from: t.varchar({ length: 42 }).notNull().$type<Address>(),
    to: t.varchar({ length: 42 }).$type<Address>(),
    contractAddress: t.varchar({ length: 42 }).$type<Address>(), // Note: incorrect
    logsBloom: t.varchar({ length: 514 }).notNull().$type<Hex>(),
    gasUsed: numeric78().notNull(),
    cumulativeGasUsed: numeric78().notNull(),
    effectiveGasPrice: numeric78().notNull(),
    status: t.text().notNull().$type<Hex>(),
    type: t.text().notNull().$type<Hex>(),
  }),
  (table) => [
    primaryKey({
      name: "transaction_receipts_pkey",
      columns: [table.chainId, table.blockNumber, table.transactionIndex],
    }),
  ],
);

export const logs = PONDER_SYNC.table(
  "logs",
  (t) => ({
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    blockNumber: t.bigint({ mode: "bigint" }).notNull(),
    logIndex: t.integer().notNull(),
    transactionIndex: t.integer().notNull(),
    blockHash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    transactionHash: t.varchar({ length: 66 }).notNull().$type<Hash>(),
    address: t.varchar({ length: 42 }).notNull().$type<Address>(),
    topic0: t.varchar({ length: 66 }).$type<Hex>(),
    topic1: t.varchar({ length: 66 }).$type<Hex>(),
    topic2: t.varchar({ length: 66 }).$type<Hex>(),
    topic3: t.varchar({ length: 66 }).$type<Hex>(),
    data: t.text().notNull().$type<Hex>(),
  }),
  (table) => [
    primaryKey({
      name: "logs_pkey",
      columns: [table.chainId, table.blockNumber, table.logIndex],
    }),
  ],
);

export const traces = PONDER_SYNC.table(
  "traces",
  (t) => ({
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    blockNumber: t.bigint({ mode: "bigint" }).notNull(),
    transactionIndex: t.integer().notNull(),
    traceAddress: t.integer().array().notNull(),
    from: t.varchar({ length: 42 }).notNull().$type<Address>(),
    to: t.varchar({ length: 42 }).$type<Address>(),
    input: t.text().notNull().$type<Hex>(),
    output: t.text().$type<Hex>(),
    value: numeric78(),
    type: t.text().notNull(),
    gas: numeric78().notNull(),
    gasUsed: numeric78().notNull(),
  }),
  (table) => [
    primaryKey({
      name: "traces_pkey",
      columns: [
        table.chainId,
        table.blockNumber,
        table.transactionIndex,
        table.traceAddress,
      ],
    }),
  ],
);

export const rpcRequestResults = PONDER_SYNC.table(
  "rpc_request_results",
  (t) => ({
    requestHash: t.text().notNull(),
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    blockNumber: t.bigint({ mode: "bigint" }),
    result: t.text().notNull(),
  }),
  (table) => [
    primaryKey({
      name: "rpc_request_results_pkey",
      columns: [table.chainId, table.requestHash],
    }),
    index("rpc_request_results_chain_id_block_number_index").on(
      table.chainId,
      table.blockNumber,
    ),
  ],
);

export const intervals = PONDER_SYNC.table("intervals", (t) => ({
  fragmentId: t.text().notNull().$type<FragmentId>().primaryKey(),
  chainId: t.bigint({ mode: "bigint" }).notNull(),
  blocks: nummultirange().notNull(),
}));

/**
 * Parents of child addresses.
 */
export const factories = PONDER_SYNC.table(
  "factories",
  (t) => ({
    id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
    fragmentId: t.text().notNull().$type<FactoryFragmentId>(),
  }),
  (table) => [
    index("factories_fragment_id_idx").on(table.fragmentId),
    unique("factories_fragment_id_key").on(table.fragmentId),
  ],
);

export const factoryAddresses = PONDER_SYNC.table(
  "factory_addresses",
  (t) => ({
    factoryId: t.integer().notNull(), // references `factories.id`
    chainId: t.bigint({ mode: "bigint" }).notNull(),
    blockNumber: t.bigint({ mode: "bigint" }).notNull(),
    address: t.text().$type<Address>().notNull(),
  }),
  (table) => [
    primaryKey({
      name: "factory_addresses_pkey",
      columns: [table.factoryId, table.address],
    }),
  ],
);
