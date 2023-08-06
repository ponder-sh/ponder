import {
  type ExpressionBuilder,
  CompiledQuery,
  Kysely,
  Migrator,
  NO_MIGRATIONS,
  PostgresDialect,
  sql,
} from "kysely";
import type { Pool } from "pg";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";
import type { NonNull } from "@/types/utils";
import { blobToBigInt } from "@/utils/decode";
import { intToBlob } from "@/utils/encode";
import { mergeIntervals } from "@/utils/intervals";
import { range } from "@/utils/range";

import type { EventStore } from "../store";
import {
  type EventStoreTables,
  type InsertableBlock,
  type InsertableLog,
  type InsertableTransaction,
  rpcToPostgresBlock,
  rpcToPostgresLog,
  rpcToPostgresTransaction,
} from "./format";
import { migrationProvider } from "./migrations";

export class PostgresEventStore implements EventStore {
  kind = "postgres" as const;
  db: Kysely<EventStoreTables>;
  migrator: Migrator;

  constructor({
    pool,
    databaseSchema,
  }: {
    pool: Pool;
    databaseSchema?: string;
  }) {
    this.db = new Kysely<EventStoreTables>({
      dialect: new PostgresDialect({
        pool,
        onCreateConnection: databaseSchema
          ? async (connection) => {
              await connection.executeQuery(
                CompiledQuery.raw(
                  `CREATE SCHEMA IF NOT EXISTS ${databaseSchema}`
                )
              );
              await connection.executeQuery(
                CompiledQuery.raw(`SET search_path = ${databaseSchema}`)
              );
            }
          : undefined,
      }),
    });

    this.migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableSchema: databaseSchema ?? "public",
    });
  }

  migrateUp = async () => {
    const { error } = await this.migrator.migrateToLatest();
    if (error) throw error;
  };

  migrateDown = async () => {
    const { error } = await this.migrator.migrateTo(NO_MIGRATIONS);
    if (error) throw error;
  };

  insertHistoricalLogs = async ({
    chainId,
    logs: rpcLogs,
  }: {
    chainId: number;
    logs: RpcLog[];
  }) => {
    const logBatches = rpcLogs.reduce<InsertableLog[][]>((acc, log, index) => {
      const batchIndex = Math.floor(index / 1000);
      acc[batchIndex] = acc[batchIndex] ?? [];
      acc[batchIndex].push({
        ...rpcToPostgresLog(log),
        chainId,
      });
      return acc;
    }, []);

    await Promise.all(
      logBatches.map(async (batch) => {
        await this.db
          .insertInto("logs")
          .values(batch)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      })
    );
  };

  insertHistoricalBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logFilterRange: { logFilterKey, blockNumberToCacheFrom },
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logFilterRange: {
      logFilterKey: string;
      blockNumberToCacheFrom: number;
    };
  }) => {
    const block: InsertableBlock = {
      ...rpcToPostgresBlock(rpcBlock),
      chainId,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...rpcToPostgresTransaction(transaction),
        chainId,
      })
    );

    const logFilterCachedRange = {
      filterKey: logFilterKey,
      startBlock: intToBlob(blockNumberToCacheFrom),
      endBlock: block.number,
    };

    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("blocks")
        .values(block)
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();
      if (transactions.length > 0) {
        await tx
          .insertInto("transactions")
          .values(transactions)
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }
      await tx
        .insertInto("logFilterCachedRanges")
        .values(logFilterCachedRange)
        .execute();
    });
  };

  insertRealtimeBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logs: rpcLogs,
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }) => {
    const block: InsertableBlock = {
      ...rpcToPostgresBlock(rpcBlock),
      chainId,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...rpcToPostgresTransaction(transaction),
        chainId,
      })
    );

    const logs: InsertableLog[] = rpcLogs.map((log) => ({
      ...rpcToPostgresLog(log),
      chainId,
    }));

    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("blocks")
        .values(block)
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();
      if (transactions.length > 0) {
        await tx
          .insertInto("transactions")
          .values(transactions)
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }
      if (logs.length > 0) {
        await tx
          .insertInto("logs")
          .values(logs)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      }
    });
  };

  deleteRealtimeData = async ({
    chainId,
    fromBlockNumber,
  }: {
    chainId: number;
    fromBlockNumber: number;
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom("blocks")
        .where("number", ">=", intToBlob(fromBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("transactions")
        .where("blockNumber", ">=", intToBlob(fromBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("logs")
        .where("blockNumber", ">=", intToBlob(fromBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("contractReadResults")
        .where("blockNumber", ">=", intToBlob(fromBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
    });
  };

  insertLogFilterCachedRanges = async ({
    logFilterKeys,
    startBlock,
    endBlock,
  }: {
    logFilterKeys: string[];
    startBlock: number;
    endBlock: number;
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await Promise.all(
        logFilterKeys.map((logFilterKey) =>
          tx
            .insertInto("logFilterCachedRanges")
            .values({
              filterKey: logFilterKey,
              startBlock: intToBlob(startBlock),
              endBlock: intToBlob(endBlock),
            })
            .execute()
        )
      );
    });
  };

  mergeLogFilterCachedRanges = async ({
    logFilterKey,
    logFilterStartBlockNumber,
  }: {
    logFilterKey: string;
    logFilterStartBlockNumber: number;
  }) => {
    const startingRangeEndBlockNumber = await this.db
      .transaction()
      .execute(async (tx) => {
        const existingRanges = await tx
          .deleteFrom("logFilterCachedRanges")
          .where("filterKey", "=", logFilterKey)
          .returningAll()
          .execute();

        const mergedIntervals = mergeIntervals(
          existingRanges.map((r) => [
            Number(blobToBigInt(r.startBlock)),
            Number(blobToBigInt(r.endBlock)),
          ])
        );

        const mergedRanges = mergedIntervals.map((interval) => {
          const [startBlock, endBlock] = interval;
          return {
            filterKey: logFilterKey,
            startBlock: intToBlob(startBlock),
            endBlock: intToBlob(endBlock),
          };
        });

        if (mergedRanges.length > 0) {
          await tx
            .insertInto("logFilterCachedRanges")
            .values(mergedRanges)
            .execute();
        }

        // After we've inserted the new ranges, find the range that contains the log filter start block number.
        // We need this to determine the new latest available event timestamp for the log filter.
        const startingRange = mergedRanges.find(
          (range) =>
            Number(blobToBigInt(range.startBlock)) <=
              logFilterStartBlockNumber &&
            Number(blobToBigInt(range.endBlock)) >= logFilterStartBlockNumber
        );

        if (!startingRange) {
          // If there is no range containing the log filter start block number, return 0. This could happen if
          // many block tasks run concurrently and the one containing the log filter start block number is late.
          return 0;
        } else {
          return Number(blobToBigInt(startingRange.endBlock));
        }
      });

    return { startingRangeEndBlockNumber };
  };

  getLogFilterCachedRanges = async ({
    logFilterKey,
  }: {
    logFilterKey: string;
  }) => {
    const results = await this.db
      .selectFrom("logFilterCachedRanges")
      .selectAll()
      .where("filterKey", "=", logFilterKey)
      .execute();

    return results.map((range) => ({
      filterKey: range.filterKey,
      startBlock: Number(blobToBigInt(range.startBlock)),
      endBlock: Number(blobToBigInt(range.endBlock)),
    }));
  };

  insertContractReadResult = async ({
    address,
    blockNumber,
    chainId,
    data,
    result,
  }: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
    result: Hex;
  }) => {
    await this.db
      .insertInto("contractReadResults")
      .values({
        address,
        blockNumber: intToBlob(blockNumber),
        chainId,
        data,
        result,
      })
      .onConflict((oc) =>
        oc.constraint("contractReadResultPrimaryKey").doUpdateSet({ result })
      )
      .execute();
  };

  getContractReadResult = async ({
    address,
    blockNumber,
    chainId,
    data,
  }: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
  }) => {
    const contractReadResult = await this.db
      .selectFrom("contractReadResults")
      .selectAll()
      .where("address", "=", address)
      .where("blockNumber", "=", intToBlob(blockNumber))
      .where("chainId", "=", chainId)
      .where("data", "=", data)
      .executeTakeFirst();

    return contractReadResult
      ? {
          ...contractReadResult,
          blockNumber: blobToBigInt(contractReadResult.blockNumber),
        }
      : null;
  };

  async *getLogEvents({
    chainId,
    fromBlockNumber,
    toBlockNumber,
    filters = [],
    pageSize = 10_000,
  }: {
    chainId: number;
    fromBlockNumber: number;
    toBlockNumber: number;
    filters: {
      name: string;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    pageSize: number;
  }) {
    const baseQuery = this.db
      .with(
        "logFilters(logFilter_name)",
        () =>
          sql`( values ${sql.join(
            filters.map((f) => sql`( ${sql.val(f.name)} )`)
          )} )`
      )
      .selectFrom("logs")
      .leftJoin("blocks", "blocks.hash", "logs.blockHash")
      .leftJoin("transactions", "transactions.hash", "logs.transactionHash")
      .innerJoin("logFilters", (join) => join.onTrue())
      .select([
        "logFilter_name",

        "logs.address as log_address",
        "logs.blockHash as log_blockHash",
        "logs.blockNumber as log_blockNumber",
        // "logs.chainId as log_chainId",
        "logs.data as log_data",
        "logs.id as log_id",
        "logs.logIndex as log_logIndex",
        "logs.topic0 as log_topic0",
        "logs.topic1 as log_topic1",
        "logs.topic2 as log_topic2",
        "logs.topic3 as log_topic3",
        "logs.transactionHash as log_transactionHash",
        "logs.transactionIndex as log_transactionIndex",

        "blocks.baseFeePerGas as block_baseFeePerGas",
        // "blocks.chainId as block_chainId",
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

        "transactions.accessList as tx_accessList",
        "transactions.blockHash as tx_blockHash",
        "transactions.blockNumber as tx_blockNumber",
        // "transactions.chainId as tx_chainId",
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
      .where("blocks.number", ">=", intToBlob(fromBlockNumber))
      .where("blocks.number", "<=", intToBlob(toBlockNumber));

    const buildFilterAndCmprs = (
      where: ExpressionBuilder<any, any>,
      filter: (typeof filters)[number]
    ) => {
      const { cmpr, or } = where;
      const cmprs = [];

      cmprs.push(cmpr("logFilter_name", "=", filter.name));
      cmprs.push(cmpr("logs.chainId", "=", sql`${sql.val(chainId)}::integer`));

      if (filter.address) {
        // If it's an array of length 1, collapse it.
        const address =
          Array.isArray(filter.address) && filter.address.length === 1
            ? filter.address[0]
            : filter.address;
        if (Array.isArray(address)) {
          cmprs.push(or(address.map((a) => cmpr("logs.address", "=", a))));
        } else {
          cmprs.push(cmpr("logs.address", "=", address));
        }
      }

      if (filter.topics) {
        for (const idx_ of range(0, 4)) {
          const idx = idx_ as 0 | 1 | 2 | 3;
          // If it's an array of length 1, collapse it.
          const raw = filter.topics[idx] ?? null;
          if (raw === null) continue;
          const topic = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
          if (Array.isArray(topic)) {
            cmprs.push(or(topic.map((a) => cmpr(`logs.topic${idx}`, "=", a))));
          } else {
            cmprs.push(cmpr(`logs.topic${idx}`, "=", topic));
          }
        }
      }

      if (filter.fromBlock) {
        cmprs.push(
          cmpr(
            "blocks.number",
            ">=",
            sql`${sql.val(intToBlob(filter.fromBlock))}::bytea`
          )
        );
      }

      if (filter.toBlock) {
        cmprs.push(
          cmpr(
            "blocks.number",
            "<=",
            sql`${sql.val(intToBlob(filter.toBlock))}::bytea`
          )
        );
      }

      return cmprs;
    };

    // Get full log objects, including the includeEventSelectors clause.
    const includedLogsBaseQuery = baseQuery
      .where((where) => {
        const { cmpr, and, or } = where;
        const cmprsForAllFilters = filters.map((filter) => {
          const cmprsForFilter = buildFilterAndCmprs(where, filter);
          if (filter.includeEventSelectors) {
            cmprsForFilter.push(
              or(
                filter.includeEventSelectors.map((t) =>
                  cmpr("logs.topic0", "=", t)
                )
              )
            );
          }
          return and(cmprsForFilter);
        });
        return or(cmprsForAllFilters);
      })
      .orderBy("blocks.number", "asc")
      .orderBy("logs.logIndex", "asc");

    // Get total count of matching logs, grouped by log filter and event selector.
    const eventCountsQuery = baseQuery
      .clearSelect()
      .select([
        "logFilter_name",
        "logs.topic0",
        this.db.fn.count("logs.id").as("count"),
      ])
      .where((where) => {
        const { and, or } = where;
        const cmprsForAllFilters = filters.map((filter) => {
          const cmprsForFilter = buildFilterAndCmprs(where, filter);
          // NOTE: Not adding the includeEventSelectors clause here.
          return and(cmprsForFilter);
        });
        return or(cmprsForAllFilters);
      })
      .groupBy(["logFilter_name", "logs.topic0"]);

    // Fetch the event counts once and include it in every response.
    const eventCountsRaw = await eventCountsQuery.execute();
    const eventCounts = eventCountsRaw.map((c) => ({
      logFilterName: String(c.logFilter_name),
      selector: c.topic0 as Hex,
      count: Number(c.count),
    }));

    let cursor:
      | {
          blockNumber: number;
          logIndex: number;
        }
      | undefined = undefined;

    while (true) {
      let query = includedLogsBaseQuery.limit(pageSize);
      if (cursor) {
        // See this comment for an explanation of the cursor logic.
        // https://stackoverflow.com/a/38017813
        // This is required to avoid skipping logs that have the same timestamp.
        query = query.where(({ and, or, cmpr }) => {
          const { blockNumber, logIndex } = cursor!;
          return and([
            cmpr("blocks.number", ">=", intToBlob(blockNumber)),
            or([
              cmpr("blocks.number", ">", intToBlob(blockNumber)),
              cmpr("logs.logIndex", ">", logIndex),
            ]),
          ]);
        });
      }

      const requestedLogs = await query.execute();

      const events = requestedLogs.map((_row) => {
        // Without this cast, the block_ and tx_ fields are all nullable
        // which makes this very annoying. Should probably add a runtime check
        // that those fields are indeed present before continuing here.
        const row = _row as NonNull<(typeof requestedLogs)[number]>;
        return {
          logFilterName: row.logFilter_name,
          log: {
            address: row.log_address,
            blockHash: row.log_blockHash,
            blockNumber: blobToBigInt(row.log_blockNumber),
            data: row.log_data,
            id: row.log_id,
            logIndex: Number(row.log_logIndex),
            removed: false,
            topics: [
              row.log_topic0,
              row.log_topic1,
              row.log_topic2,
              row.log_topic3,
            ].filter((t): t is Hex => t !== null) as [Hex, ...Hex[]] | [],
            transactionHash: row.log_transactionHash,
            transactionIndex: Number(row.log_transactionIndex),
          },
          block: {
            baseFeePerGas: row.block_baseFeePerGas
              ? blobToBigInt(row.block_baseFeePerGas)
              : null,
            difficulty: blobToBigInt(row.block_difficulty),
            extraData: row.block_extraData,
            gasLimit: blobToBigInt(row.block_gasLimit),
            gasUsed: blobToBigInt(row.block_gasUsed),
            hash: row.block_hash,
            logsBloom: row.block_logsBloom,
            miner: row.block_miner,
            mixHash: row.block_mixHash,
            nonce: row.block_nonce,
            number: blobToBigInt(row.block_number),
            parentHash: row.block_parentHash,
            receiptsRoot: row.block_receiptsRoot,
            sha3Uncles: row.block_sha3Uncles,
            size: blobToBigInt(row.block_size),
            stateRoot: row.block_stateRoot,
            timestamp: blobToBigInt(row.block_timestamp),
            totalDifficulty: blobToBigInt(row.block_totalDifficulty),
            transactionsRoot: row.block_transactionsRoot,
          },
          transaction: {
            blockHash: row.tx_blockHash,
            blockNumber: blobToBigInt(row.tx_blockNumber),
            from: row.tx_from,
            gas: blobToBigInt(row.tx_gas),
            hash: row.tx_hash,
            input: row.tx_input,
            nonce: Number(row.tx_nonce),
            r: row.tx_r,
            s: row.tx_s,
            to: row.tx_to,
            transactionIndex: Number(row.tx_transactionIndex),
            value: blobToBigInt(row.tx_value),
            v: blobToBigInt(row.tx_v),
            ...(row.tx_type === "0x0"
              ? {
                  type: "legacy",
                  gasPrice: blobToBigInt(row.tx_gasPrice),
                }
              : row.tx_type === "0x1"
              ? {
                  type: "eip2930",
                  gasPrice: blobToBigInt(row.tx_gasPrice),
                  accessList: JSON.parse(row.tx_accessList),
                }
              : row.tx_type === "0x2"
              ? {
                  type: "eip1559",
                  maxFeePerGas: blobToBigInt(row.tx_maxFeePerGas),
                  maxPriorityFeePerGas: blobToBigInt(
                    row.tx_maxPriorityFeePerGas
                  ),
                }
              : row.tx_type === "0x7e"
              ? {
                  type: "deposit",
                  maxFeePerGas: blobToBigInt(row.tx_maxFeePerGas),
                  maxPriorityFeePerGas: blobToBigInt(
                    row.tx_maxPriorityFeePerGas
                  ),
                }
              : {
                  type: row.tx_type,
                }),
          },
        } satisfies {
          logFilterName: string;
          log: Log;
          block: Block;
          transaction: Transaction;
        };
      });

      const lastRow = requestedLogs[requestedLogs.length - 1];
      const lastRowBlockNumber = lastRow?.block_number
        ? Number(blobToBigInt(lastRow.block_number))
        : undefined;
      const lastRowLogIndex = lastRow?.log_logIndex;

      yield {
        events,
        counts: eventCounts,
        pageEndsAtBlockNumber: lastRowBlockNumber,
      };

      if (events.length < pageSize) break;

      cursor = { blockNumber: lastRowBlockNumber!, logIndex: lastRowLogIndex };
    }
  }
}
