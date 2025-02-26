import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { NonRetryableError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Factory,
  Filter,
  FilterWithoutBlocks,
  Fragment,
  FragmentId,
  LogFactory,
  LogFilter,
  RawEvent,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "@/sync/filter.js";
import { fragmentToId, getFragments } from "@/sync/fragments.js";
import type { Log, Trace } from "@/types/eth.js";
import type {
  LightBlock,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import type { NonNull } from "@/types/utils.js";
import type { Interval } from "@/utils/interval.js";
import { type Kysely, type SelectQueryBuilder, sql as ksql } from "kysely";
import type { InsertObject } from "kysely";
import {
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
  checksumAddress,
  hexToBigInt,
} from "viem";
import {
  type PonderSyncSchema,
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encoding.js";

export type SyncStore = {
  insertIntervals(args: {
    intervals: {
      filter: FilterWithoutBlocks;
      interval: Interval;
    }[];
    chainId: number;
  }): Promise<void>;
  getIntervals(args: {
    filters: Filter[];
  }): Promise<Map<Filter, { fragment: Fragment; intervals: Interval[] }[]>>;
  getChildAddresses(args: {
    filter: Factory;
    limit?: number;
  }): Promise<Address[]>;
  filterChildAddresses(args: {
    filter: Factory;
    addresses: Address[];
  }): Promise<Set<Address>>;
  insertLogs(args: {
    logs: { log: SyncLog; block?: SyncBlock }[];
    shouldUpdateCheckpoint: boolean;
    chainId: number;
  }): Promise<void>;
  insertBlocks(args: { blocks: SyncBlock[]; chainId: number }): Promise<void>;
  /** Return true if the block receipt is present in the database. */
  hasBlock(args: { hash: Hash }): Promise<boolean>;
  insertTransactions(args: {
    transactions: { transaction: SyncTransaction; block: SyncBlock }[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction is present in the database. */
  hasTransaction(args: { hash: Hash }): Promise<boolean>;
  insertTransactionReceipts(args: {
    transactionReceipts: SyncTransactionReceipt[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction receipt is present in the database. */
  hasTransactionReceipt(args: { hash: Hash }): Promise<boolean>;
  insertTraces(args: {
    traces: {
      trace: SyncTrace;
      block: SyncBlock;
      transaction: SyncTransaction;
    }[];
    chainId: number;
  }): Promise<void>;
  /** Returns an ordered list of events based on the `filters` and pagination arguments. */
  getEvents(args: {
    filters: Filter[];
    from: string;
    to: string;
    limit?: number;
  }): Promise<{ events: RawEvent[]; cursor: string }>;
  insertRpcRequestResult(args: {
    request: string;
    chainId: number;
    blockNumber: bigint | undefined;
    result: string;
  }): Promise<void>;
  getRpcRequestResult(args: {
    request: string;
    chainId: number;
  }): Promise<string | undefined>;
  pruneRpcRequestResult(args: {
    blocks: Pick<LightBlock, "number">[];
    chainId: number;
  }): Promise<void>;
  pruneByChain(args: { chainId: number }): Promise<void>;
};

const logFactorySQL = (
  qb: SelectQueryBuilder<PonderSyncSchema, "logs", {}>,
  factory: LogFactory,
) =>
  qb
    .select(
      (() => {
        if (factory.childAddressLocation.startsWith("offset")) {
          const childAddressOffset = Number(
            factory.childAddressLocation.substring(6),
          );
          const start = 2 + 12 * 2 + childAddressOffset * 2 + 1;
          const length = 20 * 2;
          return ksql<Hex>`'0x' || substring(data from ${start}::int for ${length}::int)`;
        } else {
          const start = 2 + 12 * 2 + 1;
          const length = 20 * 2;
          return ksql<Hex>`'0x' || substring(${ksql.ref(
            factory.childAddressLocation,
          )} from ${start}::integer for ${length}::integer)`;
        }
      })().as("childAddress"),
    )
    .distinct()
    .$call((qb) => {
      if (Array.isArray(factory.address)) {
        return qb.where("address", "in", factory.address);
      }
      return qb.where("address", "=", factory.address);
    })
    .where("topic0", "=", factory.eventSelector)
    .where("chainId", "=", factory.chainId);

export const createSyncStore = ({
  common,
  database,
}: {
  common: Common;
  database: Database;
}): SyncStore => ({
  insertIntervals: async ({ intervals, chainId }) => {
    if (intervals.length === 0) return;

    await database.wrap(
      { method: "insertIntervals", includeTraceLogs: true },
      async () => {
        const perFragmentIntervals = new Map<FragmentId, Interval[]>();
        const values: InsertObject<PonderSyncSchema, "intervals">[] = [];

        // dedupe and merge matching fragments

        for (const { filter, interval } of intervals) {
          for (const fragment of getFragments(filter)) {
            const fragmentId = fragmentToId(fragment.fragment);
            if (perFragmentIntervals.has(fragmentId) === false) {
              perFragmentIntervals.set(fragmentId, []);
            }

            perFragmentIntervals.get(fragmentId)!.push(interval);
          }
        }

        // NOTE: In order to force proper range union behavior, `interval[1]` must
        // be rounded up.

        for (const [fragmentId, intervals] of perFragmentIntervals) {
          const numranges = intervals
            .map((interval) => {
              const start = interval[0];
              const end = interval[1] + 1;
              return `numrange(${start}, ${end}, '[]')`;
            })
            .join(", ");

          values.push({
            fragment_id: fragmentId,
            chain_id: chainId,
            blocks: ksql.raw(`nummultirange(${numranges})`),
          });
        }

        await database.qb.sync
          .insertInto("intervals")
          .values(values)
          .onConflict((oc) =>
            oc.column("fragment_id").doUpdateSet({
              blocks: ksql`intervals.blocks + excluded.blocks`,
            }),
          )
          .execute();
      },
    );
  },
  getIntervals: async ({ filters }) =>
    database.wrap(
      { method: "getIntervals", includeTraceLogs: true },
      async () => {
        let query:
          | SelectQueryBuilder<
              PonderSyncSchema,
              "intervals",
              { merged_blocks: string | null; filter: string; fragment: string }
            >
          | undefined;

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i]!;
          const fragments = getFragments(filter);
          for (let j = 0; j < fragments.length; j++) {
            const fragment = fragments[j]!;
            const _query = database.qb.sync
              .selectFrom(
                database.qb.sync
                  .selectFrom("intervals")
                  .select(ksql`unnest(blocks)`.as("blocks"))
                  .where("fragment_id", "in", fragment.adjacentIds)
                  .as("unnested"),
              )
              .select([
                ksql<string>`range_agg(unnested.blocks)`.as("merged_blocks"),
                ksql.raw(`'${i}'`).as("filter"),
                ksql.raw(`'${j}'`).as("fragment"),
              ]);
            // @ts-ignore
            query = query === undefined ? _query : query.unionAll(_query);
          }
        }

        const rows = await query!.execute();

        const result = new Map<
          Filter,
          { fragment: Fragment; intervals: Interval[] }[]
        >();

        // NOTE: `interval[1]` must be rounded down in order to offset the previous
        // rounding.

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i]!;
          const fragments = getFragments(filter);
          result.set(filter, []);
          for (let j = 0; j < fragments.length; j++) {
            const fragment = fragments[j]!;
            const intervals = rows
              .filter((row) => row.filter === `${i}`)
              .filter((row) => row.fragment === `${j}`)
              .map((row) =>
                (row.merged_blocks
                  ? (JSON.parse(
                      `[${row.merged_blocks.slice(1, -1)}]`,
                    ) as Interval[])
                  : []
                ).map((interval) => [interval[0], interval[1] - 1] as Interval),
              )[0]!;

            result
              .get(filter)!
              .push({ fragment: fragment.fragment, intervals });
          }
        }

        return result;
      },
    ),
  getChildAddresses: ({ filter, limit }) =>
    database.wrap(
      { method: "getChildAddresses", includeTraceLogs: true },
      async () => {
        return await database.qb.sync
          .selectFrom("logs")
          .$call((qb) => logFactorySQL(qb, filter))
          .$if(limit !== undefined, (qb) => qb.limit(limit!))
          .execute()
          .then((addresses) =>
            addresses.map(({ childAddress }) => childAddress),
          );
      },
    ),
  filterChildAddresses: ({ filter, addresses }) =>
    database.wrap(
      { method: "filterChildAddresses", includeTraceLogs: true },
      async () => {
        const result = await database.qb.sync
          .with(
            "addresses(address)",
            () =>
              ksql`( values ${ksql.join(addresses.map((a) => ksql`( ${ksql.val(a)} )`))} )`,
          )
          .with("childAddresses", (db) =>
            db.selectFrom("logs").$call((qb) => logFactorySQL(qb, filter)),
          )
          .selectFrom("addresses")
          .where(
            "addresses.address",
            "in",
            ksql`(SELECT "childAddress" FROM "childAddresses")`,
          )
          .selectAll()
          .execute();

        return new Set<Address>([...result.map(({ address }) => address)]);
      },
    ),
  insertLogs: async ({ logs, shouldUpdateCheckpoint, chainId }) => {
    if (logs.length === 0) return;
    await database.wrap(
      { method: "insertLogs", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(encodeLog({ log: logs[0]!.log, chainId })).length,
        );

        // As an optimization, logs that are matched by a factory do
        // not contain a checkpoint, because not corresponding block is
        // fetched (no block.timestamp). However, when a log is matched by
        // both a log filter and a factory, the checkpoint must be included
        // in the db.

        for (let i = 0; i < logs.length; i += batchSize) {
          await database.qb.sync
            .insertInto("logs")
            .values(
              logs
                .slice(i, i + batchSize)
                .map(({ log, block }) => encodeLog({ log, block, chainId })),
            )
            .onConflict((oc) =>
              oc.column("id").$call((qb) =>
                shouldUpdateCheckpoint
                  ? qb.doUpdateSet((eb) => ({
                      checkpoint: eb.ref("excluded.checkpoint"),
                    }))
                  : qb.doNothing(),
              ),
            )
            .execute();
        }
      },
    );
  },
  insertBlocks: async ({ blocks, chainId }) => {
    if (blocks.length === 0) return;
    await database.wrap(
      { method: "insertBlocks", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(encodeBlock({ block: blocks[0]!, chainId })).length,
        );

        for (let i = 0; i < blocks.length; i += batchSize) {
          await database.qb.sync
            .insertInto("blocks")
            .values(
              blocks
                .slice(i, i + batchSize)
                .map((block) => encodeBlock({ block, chainId })),
            )
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();
        }
      },
    );
  },
  hasBlock: async ({ hash }) =>
    database.wrap({ method: "hasBlock", includeTraceLogs: true }, async () => {
      return await database.qb.sync
        .selectFrom("blocks")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTransactions: async ({ transactions, chainId }) => {
    if (transactions.length === 0) return;
    await database.wrap(
      { method: "insertTransactions", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(
              encodeTransaction({
                transaction: transactions[0]!.transaction,
                block: transactions[0]!.block,
                chainId,
              }),
            ).length,
        );

        // As an optimization for the migration, transactions inserted before 0.8 do not
        // contain a checkpoint. However, for correctness the checkpoint must be inserted
        // for new transactions (using onConflictDoUpdate).

        for (let i = 0; i < transactions.length; i += batchSize) {
          await database.qb.sync
            .insertInto("transactions")
            .values(
              transactions
                .slice(i, i + batchSize)
                .map(({ transaction, block }) =>
                  encodeTransaction({ transaction, block, chainId }),
                ),
            )
            .onConflict((oc) =>
              oc.column("hash").doUpdateSet((eb) => ({
                checkpoint: eb.ref("excluded.checkpoint"),
              })),
            )
            .execute();
        }
      },
    );
  },
  hasTransaction: async ({ hash }) =>
    database.wrap(
      { method: "hasTransaction", includeTraceLogs: true },
      async () => {
        return await database.qb.sync
          .selectFrom("transactions")
          .select("hash")
          .where("hash", "=", hash)
          .executeTakeFirst()
          .then((result) => result !== undefined);
      },
    ),
  insertTransactionReceipts: async ({ transactionReceipts, chainId }) => {
    if (transactionReceipts.length === 0) return;
    await database.wrap(
      { method: "insertTransactionReceipts", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(
              encodeTransactionReceipt({
                transactionReceipt: transactionReceipts[0]!,
                chainId,
              }),
            ).length,
        );

        for (let i = 0; i < transactionReceipts.length; i += batchSize) {
          await database.qb.sync
            .insertInto("transactionReceipts")
            .values(
              transactionReceipts
                .slice(i, i + batchSize)
                .map((transactionReceipt) =>
                  encodeTransactionReceipt({
                    transactionReceipt,
                    chainId,
                  }),
                ),
            )
            .onConflict((oc) => oc.column("transactionHash").doNothing())
            .execute();
        }
      },
    );
  },
  hasTransactionReceipt: async ({ hash }) =>
    database.wrap(
      { method: "hasTransactionReceipt", includeTraceLogs: true },
      async () => {
        return await database.qb.sync
          .selectFrom("transactionReceipts")
          .select("transactionHash")
          .where("transactionHash", "=", hash)
          .executeTakeFirst()
          .then((result) => result !== undefined);
      },
    ),
  insertTraces: async ({ traces, chainId }) => {
    if (traces.length === 0) return;
    await database.wrap(
      { method: "insertTraces", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(
              encodeTrace({
                trace: traces[0]!.trace.trace,
                block: traces[0]!.block,
                transaction: traces[0]!.transaction,
                chainId,
              }),
            ).length,
        );

        for (let i = 0; i < traces.length; i += batchSize) {
          await database.qb.sync
            .insertInto("traces")
            .values(
              traces
                .slice(i, i + batchSize)
                .map(({ trace, block, transaction }) =>
                  encodeTrace({
                    trace: trace.trace,
                    block,
                    transaction,
                    chainId,
                  }),
                ),
            )
            .onConflict((oc) => oc.column("id").doNothing())
            .execute();
        }
      },
    );
  },
  getEvents: async ({ filters, from, to, limit }) =>
    database.wrap({ method: "getEvents", includeTraceLogs: true }, async () => {
      let query:
        | SelectQueryBuilder<
            PonderSyncSchema,
            "logs" | "blocks" | "traces" | "transactions",
            {
              filterIndex: number;
              checkpoint: string;
              chainId: number;
              logId: string;
              blockHash: string;
              transactionHash: string;
              traceId: string;
            }
          >
        | undefined;

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]!;

        const _query =
          filter.type === "log"
            ? logSQL(filter, database.qb.sync, i)
            : filter.type === "block"
              ? blockSQL(filter, database.qb.sync, i)
              : filter.type === "transaction"
                ? transactionSQL(filter, database.qb.sync, i)
                : filter.type === "transfer"
                  ? transferSQL(filter, database.qb.sync, i)
                  : traceSQL(filter, database.qb.sync, i);

        // @ts-ignore
        query = query === undefined ? _query : query.unionAll(_query);
      }

      const rows = await database.qb.sync
        .with("event", () => query!)
        .selectFrom("event")
        .select([
          "event.filterIndex as event_filterIndex",
          "event.checkpoint as event_checkpoint",
        ])
        .innerJoin("blocks", "blocks.hash", "event.blockHash")
        .select([
          "blocks.baseFeePerGas as block_baseFeePerGas",
          "blocks.difficulty as block_difficulty",
          "blocks.extraData as block_extraData",
          "blocks.gasLimit as block_gasLimit",
          "blocks.gasUsed as block_gasUsed",
          "blocks.hash as block_hash",
          "blocks.logsBloom as block_logsBloom",
          "blocks.miner as block_miner",
          "blocks.mixHash as block_mixHash",
          "blocks.nonce as block_nonce",
          "blocks.number as block_number",
          "blocks.parentHash as block_parentHash",
          "blocks.receiptsRoot as block_receiptsRoot",
          "blocks.sha3Uncles as block_sha3Uncles",
          "blocks.size as block_size",
          "blocks.stateRoot as block_stateRoot",
          "blocks.timestamp as block_timestamp",
          "blocks.totalDifficulty as block_totalDifficulty",
          "blocks.transactionsRoot as block_transactionsRoot",
        ])
        .leftJoin("logs", "logs.id", "event.logId")
        .select([
          "logs.address as log_address",
          "logs.chainId as log_chainId",
          "logs.data as log_data",
          "logs.id as log_id",
          "logs.logIndex as log_logIndex",
          "logs.topic0 as log_topic0",
          "logs.topic1 as log_topic1",
          "logs.topic2 as log_topic2",
          "logs.topic3 as log_topic3",
        ])
        .leftJoin("transactions", "transactions.hash", "event.transactionHash")
        .select([
          "transactions.accessList as tx_accessList",
          "transactions.from as tx_from",
          "transactions.gas as tx_gas",
          "transactions.gasPrice as tx_gasPrice",
          "transactions.hash as tx_hash",
          "transactions.input as tx_input",
          "transactions.maxFeePerGas as tx_maxFeePerGas",
          "transactions.maxPriorityFeePerGas as tx_maxPriorityFeePerGas",
          "transactions.nonce as tx_nonce",
          "transactions.r as tx_r",
          "transactions.s as tx_s",
          "transactions.to as tx_to",
          "transactions.transactionIndex as tx_transactionIndex",
          "transactions.type as tx_type",
          "transactions.value as tx_value",
          "transactions.v as tx_v",
        ])
        .leftJoin("traces", "traces.id", "event.traceId")
        .select([
          "traces.id as trace_id",
          "traces.type as trace_callType",
          "traces.from as trace_from",
          "traces.to as trace_to",
          "traces.gas as trace_gas",
          "traces.gasUsed as trace_gasUsed",
          "traces.input as trace_input",
          "traces.output as trace_output",
          "traces.error as trace_error",
          "traces.revertReason as trace_revertReason",
          "traces.value as trace_value",
          "traces.index as trace_index",
          "traces.subcalls as trace_subcalls",
        ])
        .leftJoin(
          "transactionReceipts",
          "transactionReceipts.transactionHash",
          "event.transactionHash",
        )
        .select([
          "transactionReceipts.contractAddress as txr_contractAddress",
          "transactionReceipts.cumulativeGasUsed as txr_cumulativeGasUsed",
          "transactionReceipts.effectiveGasPrice as txr_effectiveGasPrice",
          "transactionReceipts.from as txr_from",
          "transactionReceipts.gasUsed as txr_gasUsed",
          "transactionReceipts.logsBloom as txr_logsBloom",
          "transactionReceipts.status as txr_status",
          "transactionReceipts.to as txr_to",
          "transactionReceipts.type as txr_type",
        ])
        .where("event.checkpoint", ">", from)
        .where("event.checkpoint", "<=", to)
        .orderBy("event.checkpoint", "asc")
        .orderBy("event.filterIndex", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!))
        .execute()
        .catch((error) => {
          if (error.message.includes("statement timeout")) {
            throw new NonRetryableError(error.message);
          } else {
            throw error;
          }
        });

      const events = rows.map((_row) => {
        // Without this cast, the block_ and tx_ fields are all nullable
        // which makes this very annoying. Should probably add a runtime check
        // that those fields are indeed present before continuing here.
        const row = _row as NonNull<(typeof rows)[number]>;

        const filter = filters[row.event_filterIndex]!;

        const hasLog = row.log_id !== null;
        const hasTransaction = row.tx_hash !== null;
        const hasTrace = row.trace_id !== null;
        const hasTransactionReceipt =
          shouldGetTransactionReceipt(filter) && row.txr_from !== null;

        return {
          chainId: filter.chainId,
          sourceIndex: Number(row.event_filterIndex),
          checkpoint: row.event_checkpoint,
          block: {
            baseFeePerGas:
              row.block_baseFeePerGas !== null
                ? BigInt(row.block_baseFeePerGas)
                : null,
            difficulty: BigInt(row.block_difficulty),
            extraData: row.block_extraData,
            gasLimit: BigInt(row.block_gasLimit),
            gasUsed: BigInt(row.block_gasUsed),
            hash: row.block_hash,
            logsBloom: row.block_logsBloom,
            miner: checksumAddress(row.block_miner),
            mixHash: row.block_mixHash,
            nonce: row.block_nonce,
            number: BigInt(row.block_number),
            parentHash: row.block_parentHash,
            receiptsRoot: row.block_receiptsRoot,
            sha3Uncles: row.block_sha3Uncles,
            size: BigInt(row.block_size),
            stateRoot: row.block_stateRoot,
            timestamp: BigInt(row.block_timestamp),
            totalDifficulty:
              row.block_totalDifficulty !== null
                ? BigInt(row.block_totalDifficulty)
                : null,
            transactionsRoot: row.block_transactionsRoot,
          },
          log: hasLog
            ? {
                address: checksumAddress(row.log_address!),
                data: row.log_data,
                id: row.log_id as Log["id"],
                logIndex: Number(row.log_logIndex),
                removed: false,
                topics: [
                  row.log_topic0,
                  row.log_topic1,
                  row.log_topic2,
                  row.log_topic3,
                ].filter((t): t is Hex => t !== null) as [Hex, ...Hex[]] | [],
              }
            : undefined,
          transaction: hasTransaction
            ? {
                from: checksumAddress(row.tx_from),
                gas: BigInt(row.tx_gas),
                hash: row.tx_hash,
                input: row.tx_input,
                nonce: Number(row.tx_nonce),
                r: row.tx_r,
                s: row.tx_s,
                to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
                transactionIndex: Number(row.tx_transactionIndex),
                value: BigInt(row.tx_value),
                v: row.tx_v !== null ? BigInt(row.tx_v) : null,
                ...(row.tx_type === "0x0"
                  ? {
                      type: "legacy",
                      gasPrice: BigInt(row.tx_gasPrice),
                    }
                  : row.tx_type === "0x1"
                    ? {
                        type: "eip2930",
                        gasPrice: BigInt(row.tx_gasPrice),
                        accessList: JSON.parse(row.tx_accessList),
                      }
                    : row.tx_type === "0x2"
                      ? {
                          type: "eip1559",
                          maxFeePerGas: BigInt(row.tx_maxFeePerGas),
                          maxPriorityFeePerGas: BigInt(
                            row.tx_maxPriorityFeePerGas,
                          ),
                        }
                      : row.tx_type === "0x7e"
                        ? {
                            type: "deposit",
                            maxFeePerGas:
                              row.tx_maxFeePerGas !== null
                                ? BigInt(row.tx_maxFeePerGas)
                                : undefined,
                            maxPriorityFeePerGas:
                              row.tx_maxPriorityFeePerGas !== null
                                ? BigInt(row.tx_maxPriorityFeePerGas)
                                : undefined,
                          }
                        : {
                            type: row.tx_type,
                          }),
              }
            : undefined,
          trace: hasTrace
            ? {
                id: row.trace_id,
                type: row.trace_callType as Trace["type"],
                from: checksumAddress(row.trace_from),
                to: checksumAddress(row.trace_to),
                gas: BigInt(row.trace_gas),
                gasUsed: BigInt(row.trace_gasUsed),
                input: row.trace_input,
                output: row.trace_output,
                value: BigInt(row.trace_value),
                traceIndex: Number(row.trace_index),
                subcalls: Number(row.trace_subcalls),
              }
            : undefined,
          transactionReceipt: hasTransactionReceipt
            ? {
                contractAddress: row.txr_contractAddress
                  ? checksumAddress(row.txr_contractAddress)
                  : null,
                cumulativeGasUsed: BigInt(row.txr_cumulativeGasUsed),
                effectiveGasPrice: BigInt(row.txr_effectiveGasPrice),
                from: checksumAddress(row.txr_from),
                gasUsed: BigInt(row.txr_gasUsed),
                logsBloom: row.txr_logsBloom,
                status:
                  row.txr_status === "0x1"
                    ? "success"
                    : row.txr_status === "0x0"
                      ? "reverted"
                      : (row.txr_status as TransactionReceipt["status"]),
                to: row.txr_to ? checksumAddress(row.txr_to) : null,
                type:
                  row.txr_type === "0x0"
                    ? "legacy"
                    : row.txr_type === "0x1"
                      ? "eip2930"
                      : row.tx_type === "0x2"
                        ? "eip1559"
                        : row.tx_type === "0x7e"
                          ? "deposit"
                          : row.tx_type,
              }
            : undefined,
        } satisfies RawEvent;
      });

      let cursor: string;
      if (events.length !== limit) {
        cursor = to;
      } else {
        cursor = events[events.length - 1]!.checkpoint!;
      }

      return { events, cursor };
    }),
  insertRpcRequestResult: async ({ request, blockNumber, chainId, result }) =>
    database.wrap(
      { method: "insertRpcRequestResult", includeTraceLogs: true },
      async () => {
        await database.qb.sync
          .insertInto("rpc_request_results")
          .values({
            request,
            block_number: blockNumber,
            chain_id: chainId,
            result,
          })
          .onConflict((oc) =>
            oc.columns(["request_hash", "chain_id"]).doUpdateSet({ result }),
          )
          .execute();
      },
    ),
  getRpcRequestResult: async ({ request, chainId }) =>
    database.wrap(
      { method: "getRpcRequestResult", includeTraceLogs: true },
      async () => {
        const result = await database.qb.sync
          .selectFrom("rpc_request_results")
          .select("result")

          .where("request_hash", "=", ksql`MD5(${request})`)
          .where("chain_id", "=", chainId)
          .executeTakeFirst();

        return result?.result;
      },
    ),
  pruneRpcRequestResult: async ({ blocks, chainId }) =>
    database.wrap(
      { method: "pruneRpcRequestResult", includeTraceLogs: true },
      async () => {
        if (blocks.length === 0) return;

        const numbers = blocks.map(({ number }) =>
          hexToBigInt(number).toString(),
        );

        await database.qb.sync
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .where("block_number", "in", numbers)
          .execute();
      },
    ),
  pruneByChain: async ({ chainId }) =>
    database.wrap({ method: "pruneByChain", includeTraceLogs: true }, () =>
      database.qb.sync.transaction().execute(async (tx) => {
        await tx.deleteFrom("logs").where("chainId", "=", chainId).execute();
        await tx.deleteFrom("blocks").where("chainId", "=", chainId).execute();
        await tx
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .execute();
        await tx.deleteFrom("traces").where("chainId", "=", chainId).execute();
        await tx
          .deleteFrom("transactions")
          .where("chainId", "=", chainId)
          .execute();
        await tx
          .deleteFrom("transactionReceipts")
          .where("chainId", "=", chainId)
          .execute();
      }),
    ),
});

const addressSQL = (
  qb: SelectQueryBuilder<PonderSyncSchema, "logs" | "blocks" | "traces", {}>,
  db: Kysely<PonderSyncSchema>,
  address: LogFilter["address"],
  column: "address" | "from" | "to",
) => {
  if (typeof address === "string") return qb.where(column, "=", address);
  if (isAddressFactory(address)) {
    return qb.where(
      column,
      "in",
      db.selectFrom("logs").$call((qb) => logFactorySQL(qb, address)),
    );
  }
  if (Array.isArray(address)) return qb.where(column, "in", address);

  return qb;
};

const logSQL = (
  filter: LogFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("logs")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "transactionHash",
      "id as logId",
      ksql`null`.as("traceId"),
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => {
      for (const idx of [0, 1, 2, 3] as const) {
        // If it's an array of length 1, collapse it.
        const raw = filter[`topic${idx}`] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
        if (Array.isArray(topic)) {
          qb = qb.where((eb) =>
            eb.or(topic.map((t) => eb(`logs.topic${idx}`, "=", t))),
          );
        } else {
          qb = qb.where(`logs.topic${idx}`, "=", topic);
        }
      }
      return qb;
    })
    .$call((qb) => addressSQL(qb as any, db, filter.address, "address"))
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );

const blockSQL = (
  filter: BlockFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("blocks")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "hash as blockHash",
      ksql`null`.as("transactionHash"),
      ksql`null`.as("logId"),
      ksql`null`.as("traceId"),
    ])
    .where("chainId", "=", filter.chainId)
    .$if(filter !== undefined && filter.interval !== undefined, (qb) =>
      qb.where(ksql`(number - ${filter.offset}) % ${filter.interval} = 0`),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("number", "<=", filter.toBlock!.toString()),
    );

const transactionSQL = (
  filter: TransactionFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("transactions")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "hash as transactionHash",
      ksql`null`.as("logId"),
      ksql`null`.as("traceId"),
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(qb as any, db, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(qb as any, db, filter.toAddress, "to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where(
        db
          .selectFrom("transactionReceipts")
          .select("status")
          .where(
            "transactionReceipts.transactionHash",
            "=",
            ksql.ref("transactions.hash"),
          ),
        "=",
        "0x1",
      ),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );

const transferSQL = (
  filter: TransferFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("traces")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "transactionHash",
      ksql`null`.as("logId"),
      "id as traceId",
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(qb as any, db, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(qb as any, db, filter.toAddress, "to"))
    .where("value", ">", "0")
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("isReverted", "=", 0),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );

const traceSQL = (
  filter: TraceFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("traces")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "transactionHash",
      ksql`null`.as("logId"),
      "id as traceId",
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(qb as any, db, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(qb as any, db, filter.toAddress, "to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("isReverted", "=", 0),
    )
    .$if(filter.callType !== undefined, (qb) =>
      qb.where("type", "=", filter.callType!),
    )
    .$if(filter.functionSelector !== undefined, (qb) => {
      if (Array.isArray(filter.functionSelector)) {
        return qb.where("functionSelector", "in", filter.functionSelector!);
      } else {
        return qb.where("functionSelector", "=", filter.functionSelector!);
      }
    })
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );
