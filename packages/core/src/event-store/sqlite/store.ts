import type Sqlite from "better-sqlite3";
import {
  type ExpressionBuilder,
  type Transaction as KyselyTransaction,
  Kysely,
  Migrator,
  sql,
  SqliteDialect,
} from "kysely";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";
import type { NonNull } from "@/types/utils";
import { bigIntMax, bigIntMin } from "@/utils/bigint";
import { blobToBigInt } from "@/utils/decode";
import { intToBlob } from "@/utils/encode";
import { intervalIntersectionMany } from "@/utils/interval";
import { buildLogFilterFragments } from "@/utils/logFilter";
import { toLowerCase } from "@/utils/lowercase";
import { range } from "@/utils/range";

import type { EventStore } from "../store";
import {
  type EventStoreTables,
  rpcToSqliteBlock,
  rpcToSqliteLog,
  rpcToSqliteTransaction,
} from "./format";
import { migrationProvider } from "./migrations";

export class SqliteEventStore implements EventStore {
  kind = "sqlite" as const;
  db: Kysely<EventStoreTables>;
  migrator: Migrator;

  constructor({ db }: { db: Sqlite.Database }) {
    this.db = new Kysely<EventStoreTables>({
      dialect: new SqliteDialect({ database: db }),
    });

    this.migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
    });
  }

  migrateUp = async () => {
    const { error } = await this.migrator.migrateToLatest();
    if (error) throw error;
  };

  async kill() {
    await this.db.destroy();
  }

  insertHistoricalLogFilterInterval = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logs: rpcLogs,
    logFilter,
    interval,
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    logFilter: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
    };
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("blocks")
        .values({ ...rpcToSqliteBlock(rpcBlock), chainId })
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();

      for (const rpcTransaction of rpcTransactions) {
        await tx
          .insertInto("transactions")
          .values({ ...rpcToSqliteTransaction(rpcTransaction), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }

      for (const rpcLog of rpcLogs) {
        await tx
          .insertInto("logs")
          .values({ ...rpcToSqliteLog(rpcLog), chainId })
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      }

      await this.insertLogFilterInterval({
        tx,
        chainId,
        logFilters: [logFilter],
        interval,
      });
    });
  };

  getLogFilterIntervals = async ({
    chainId,
    logFilter: { address, topics },
  }: {
    chainId: number;
    logFilter: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
    };
  }) => {
    const logFilterFragments = buildLogFilterFragments({
      address,
      topics,
    }).map((f, idx) => ({ idx, ...f }));

    const baseQuery = this.db
      .with(
        "logFilterFragments(fragmentIndex, fragmentAddress, fragmentTopic0, fragmentTopic1, fragmentTopic2, fragmentTopic3)",
        () =>
          sql`( values ${sql.join(
            logFilterFragments.map(
              (f) =>
                sql`( ${sql.val(f.idx)}, ${sql.val(f.address)}, ${sql.val(
                  f.topic0
                )}, ${sql.val(f.topic1)}, ${sql.val(f.topic2)}, ${sql.val(
                  f.topic3
                )} )`
            )
          )} )`
      )
      .selectFrom("logFilterIntervals")
      .leftJoin("logFilters", "logFilterId", "logFilters.id")
      .innerJoin("logFilterFragments", (join) => {
        let baseJoin = join.on(({ or, cmpr }) =>
          or([
            cmpr("address", "is", null),
            cmpr("fragmentAddress", "=", sql.ref("address")),
          ])
        );
        for (const idx_ of range(0, 4)) {
          baseJoin = baseJoin.on(({ or, cmpr }) => {
            const idx = idx_ as 0 | 1 | 2 | 3;
            return or([
              cmpr(`topic${idx}`, "is", null),
              cmpr(`fragmentTopic${idx}`, "=", sql.ref(`topic${idx}`)),
            ]);
          });
        }

        return baseJoin;
      })
      .select(["fragmentIndex", "startBlock", "endBlock", "endBlockTimestamp"])
      .where("chainId", "=", chainId);

    const intervals = await baseQuery.execute();

    const intervalsByFragment = intervals.reduce((acc, cur) => {
      const { fragmentIndex, ...rest } = cur;
      acc[fragmentIndex] ||= [];
      acc[fragmentIndex].push(rest);
      return acc;
    }, {} as Record<number, { startBlock: bigint; endBlock: bigint; endBlockTimestamp: bigint }[]>);

    const fragmentIntervals = logFilterFragments.map((f) => {
      return (intervalsByFragment[f.idx] ?? []).map(
        (r) =>
          [Number(r.startBlock), Number(r.endBlock)] satisfies [number, number]
      );
    });

    const totalIntervals = intervalIntersectionMany(fragmentIntervals);

    return totalIntervals;
  };

  insertHistoricalFactoryContractInterval = async ({
    chainId,
    newChildContracts,
    factoryContract,
    interval,
  }: {
    chainId: number;
    newChildContracts: {
      address: Hex;
      creationBlock: bigint;
    }[];
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }) => {
    await this.db.transaction().execute(async (tx) => {
      const address = toLowerCase(factoryContract.address);
      const eventSelector = factoryContract.eventSelector;

      const { id: factoryContractId } = await tx
        .insertInto("factoryContracts")
        .values({ chainId, address, eventSelector })
        // Note that we need to REPLACE here rather than IGNORE so that the
        // RETURNING clause works as expected (we need the ID of this row).
        .onConflict((oc) => oc.doUpdateSet({ chainId, address, eventSelector }))
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const childContract of newChildContracts) {
        await tx
          .insertInto("childContracts")
          .values({
            factoryContractId,
            address: toLowerCase(childContract.address),
            creationBlock: childContract.creationBlock,
          })
          .execute();
      }

      await this.insertFactoryContractInterval({
        tx,
        chainId,
        factoryContracts: [factoryContract],
        interval,
      });
    });
  };

  getFactoryContractIntervals = async ({
    chainId,
    factoryContract: { address, eventSelector },
  }: {
    chainId: number;
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
  }) => {
    const intervals = await this.db
      .selectFrom("factoryContractIntervals")
      .select(["startBlock", "endBlock"])
      .leftJoin("factoryContracts", "factoryContractId", "factoryContracts.id")
      .where("chainId", "=", chainId)
      .where("factoryContracts.address", "=", toLowerCase(address))
      .where("factoryContracts.eventSelector", "=", eventSelector)
      .execute();

    return intervals.map(
      (i) => [Number(i.startBlock), Number(i.endBlock)] as [number, number]
    );
  };

  async *getChildContractAddresses({
    chainId,
    upToBlockNumber,
    factoryContract: { address, eventSelector },
    pageSize = 10_000,
  }: {
    chainId: number;
    upToBlockNumber: bigint;
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
    pageSize?: number;
  }) {
    const baseQuery = this.db
      .selectFrom("childContracts")
      .leftJoin("factoryContracts", "factoryContractId", "factoryContracts.id")
      .select(["childContracts.address", "childContracts.creationBlock"])
      .where("chainId", "=", chainId)
      .where("factoryContracts.address", "=", toLowerCase(address))
      .where("factoryContracts.eventSelector", "=", eventSelector)
      .limit(pageSize)
      .where("childContracts.creationBlock", "<=", upToBlockNumber);

    let cursor: bigint | undefined = undefined;

    while (true) {
      let query = baseQuery;

      if (cursor) {
        query = query.where("childContracts.creationBlock", ">", cursor);
      }

      const batch = await query.execute();

      const lastRow = batch[batch.length - 1];
      if (lastRow) {
        cursor = lastRow.creationBlock;
      }

      yield batch.map((c) => c.address);

      if (batch.length < pageSize) break;
    }
  }

  insertHistoricalChildContractInterval = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logs: rpcLogs,
    factoryContract,
    interval,
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("blocks")
        .values({ ...rpcToSqliteBlock(rpcBlock), chainId })
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();

      for (const rpcTransaction of rpcTransactions) {
        await tx
          .insertInto("transactions")
          .values({ ...rpcToSqliteTransaction(rpcTransaction), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }

      for (const rpcLog of rpcLogs) {
        await tx
          .insertInto("logs")
          .values({ ...rpcToSqliteLog(rpcLog), chainId })
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      }

      await this.insertChildContractInterval({
        tx,
        chainId,
        factoryContracts: [factoryContract],
        interval,
      });
    });
  };

  getChildContractIntervals = async ({
    chainId,
    factoryContract: { address, eventSelector },
  }: {
    chainId: number;
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
  }) => {
    const intervals = await this.db
      .selectFrom("childContractIntervals")
      .select(["startBlock", "endBlock"])
      .leftJoin("factoryContracts", "factoryContractId", "factoryContracts.id")
      .where("chainId", "=", chainId)
      .where("factoryContracts.address", "=", toLowerCase(address))
      .where("factoryContracts.eventSelector", "=", eventSelector)
      .execute();

    return intervals.map(
      (i) => [Number(i.startBlock), Number(i.endBlock)] as [number, number]
    );
  };

  /** REALTIME */

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
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("blocks")
        .values({ ...rpcToSqliteBlock(rpcBlock), chainId })
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();

      for (const rpcTransaction of rpcTransactions) {
        await tx
          .insertInto("transactions")
          .values({ ...rpcToSqliteTransaction(rpcTransaction), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }

      for (const rpcLog of rpcLogs) {
        await tx
          .insertInto("logs")
          .values({ ...rpcToSqliteLog(rpcLog), chainId })
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      }
    });
  };

  insertRealtimeChildContracts = async ({
    chainId,
    newChildContracts,
    factoryContract,
  }: {
    chainId: number;
    newChildContracts: {
      address: Hex;
      creationBlock: bigint;
    }[];
    factoryContract: {
      address: Hex;
      eventSelector: Hex;
    };
  }) => {
    await this.db.transaction().execute(async (tx) => {
      const address = toLowerCase(factoryContract.address);
      const eventSelector = factoryContract.eventSelector;

      const { id: factoryContractId } = await tx
        .insertInto("factoryContracts")
        .values({ chainId, address, eventSelector })
        // Note that we need to REPLACE here rather than IGNORE so that the
        // RETURNING clause works as expected (we need the ID of this row).
        .onConflict((oc) => oc.doUpdateSet({ chainId, address, eventSelector }))
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const childContract of newChildContracts) {
        await tx
          .insertInto("childContracts")
          .values({
            factoryContractId,
            address: toLowerCase(childContract.address),
            creationBlock: childContract.creationBlock,
          })
          .execute();
      }
    });
  };

  insertRealtimeInterval = async ({
    chainId,
    logFilters,
    factoryContracts,
    interval,
  }: {
    chainId: number;
    logFilters: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
    }[];
    factoryContracts: {
      address: Hex;
      eventSelector: Hex;
    }[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await this.insertLogFilterInterval({
        tx,
        chainId,
        logFilters,
        interval,
      });

      await this.insertFactoryContractInterval({
        tx,
        chainId,
        factoryContracts,
        interval,
      });

      await this.insertChildContractInterval({
        tx,
        chainId,
        factoryContracts,
        interval,
      });
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

  /** SYNC HELPER METHODS */

  private insertLogFilterInterval = async ({
    tx,
    chainId,
    logFilters,
    interval: { startBlock, endBlock, endBlockTimestamp },
  }: {
    tx: KyselyTransaction<EventStoreTables>;
    chainId: number;
    logFilters: {
      address?: Hex | Hex[];
      topics?: (Hex | Hex[] | null)[];
    }[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }) => {
    const logFilterFragments = logFilters
      .map(({ address, topics }) =>
        buildLogFilterFragments({
          address,
          topics,
        })
      )
      .flat();

    for (const logFilterFragment of logFilterFragments) {
      // Get log filter fragment row (if it exists). This is ugly because we can't
      // use a unique constraint that contains nullable columns in SQLite (`null`
      // values are treated as different).
      let logFilterRow = await tx
        .selectFrom("logFilters")
        .select("id")
        .where(({ and, cmpr }) => {
          const cmprs = [];

          for (const field of [
            "address",
            "topic0",
            "topic1",
            "topic2",
            "topic3",
          ] as const) {
            if (logFilterFragment[field] === null) {
              cmprs.push(cmpr(field, "is", null));
            } else {
              cmprs.push(cmpr(field, "=", logFilterFragment[field]));
            }
          }
          return and(cmprs);
        })
        .executeTakeFirst();

      // Insert log filter fragment if not found.
      if (!logFilterRow) {
        logFilterRow = await tx
          .insertInto("logFilters")
          .values({ ...logFilterFragment, chainId })
          .returning("id")
          .executeTakeFirstOrThrow();
      }

      const logFilterId = logFilterRow.id;

      const overlappingIntervals = await tx
        .selectFrom("logFilterIntervals")
        .selectAll()
        .where("logFilterId", "=", logFilterId)
        .where(({ and, or, cmpr }) =>
          or([
            // Existing interval endBlock falls within new interval.
            and([
              cmpr("endBlock", ">=", startBlock - 1n),
              cmpr("endBlock", "<=", endBlock + 1n),
            ]),
            // Existing interval startBlock falls within new interval.
            and([
              cmpr("startBlock", ">=", startBlock - 1n),
              cmpr("startBlock", "<=", endBlock + 1n),
            ]),
            // New interval is fully within existing interval.
            and([
              cmpr("startBlock", "<=", startBlock - 1n),
              cmpr("endBlock", ">=", endBlock + 1n),
            ]),
          ])
        )
        .execute();

      if (overlappingIntervals.length > 0) {
        await tx
          .deleteFrom("logFilterIntervals")
          .where(
            "id",
            "in",
            overlappingIntervals.map((r) => r.id)
          )
          .execute();
      }

      await tx
        .insertInto("logFilterIntervals")
        .values({
          logFilterId,
          startBlock: bigIntMin([
            ...overlappingIntervals.map((r) => r.startBlock),
            startBlock,
          ]),
          endBlock: bigIntMax([
            ...overlappingIntervals.map((r) => r.endBlock),
            endBlock,
          ]),
          endBlockTimestamp: bigIntMax([
            ...overlappingIntervals.map((r) => r.endBlockTimestamp),
            endBlockTimestamp,
          ]),
        })
        .execute();
    }
  };

  private insertFactoryContractInterval = async ({
    tx,
    chainId,
    factoryContracts,
    interval: { startBlock, endBlock },
  }: {
    tx: KyselyTransaction<EventStoreTables>;
    chainId: number;
    factoryContracts: {
      address: Hex;
      eventSelector: Hex;
    }[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
    };
  }) => {
    for (const factoryContract of factoryContracts) {
      const address = toLowerCase(factoryContract.address);
      const eventSelector = factoryContract.eventSelector;

      const { id: factoryContractId } = await tx
        .insertInto("factoryContracts")
        .values({ chainId, address, eventSelector })
        // Note that we need to REPLACE here rather than IGNORE so that the
        // RETURNING clause works as expected (we need the ID of this row).
        .onConflict((oc) => oc.doUpdateSet({ chainId, address, eventSelector }))
        .returningAll()
        .executeTakeFirstOrThrow();

      const overlappingIntervals = await tx
        .selectFrom("factoryContractIntervals")
        .selectAll()
        .where("factoryContractId", "=", factoryContractId)
        .where(({ and, or, cmpr }) =>
          or([
            // Existing interval endBlock falls within new interval.
            and([
              cmpr("endBlock", ">=", startBlock - 1n),
              cmpr("endBlock", "<=", endBlock + 1n),
            ]),
            // Existing interval startBlock falls within new interval.
            and([
              cmpr("startBlock", ">=", startBlock - 1n),
              cmpr("startBlock", "<=", endBlock + 1n),
            ]),
            // New interval is fully within existing interval.
            and([
              cmpr("startBlock", "<=", startBlock - 1n),
              cmpr("endBlock", ">=", endBlock + 1n),
            ]),
          ])
        )
        .execute();

      if (overlappingIntervals.length > 0) {
        await tx
          .deleteFrom("factoryContractIntervals")
          .where(
            "id",
            "in",
            overlappingIntervals.map((r) => r.id)
          )
          .execute();
      }

      await tx
        .insertInto("factoryContractIntervals")
        .values({
          factoryContractId,
          startBlock: bigIntMin([
            ...overlappingIntervals.map((r) => r.startBlock),
            startBlock,
          ]),
          endBlock: bigIntMax([
            ...overlappingIntervals.map((r) => r.endBlock),
            endBlock,
          ]),
        })
        .execute();
    }
  };

  private insertChildContractInterval = async ({
    tx,
    chainId,
    factoryContracts,
    interval: { startBlock, endBlock, endBlockTimestamp },
  }: {
    tx: KyselyTransaction<EventStoreTables>;
    chainId: number;
    factoryContracts: {
      address: Hex;
      eventSelector: Hex;
    }[];
    interval: {
      startBlock: bigint;
      endBlock: bigint;
      endBlockTimestamp: bigint;
    };
  }) => {
    for (const factoryContract of factoryContracts) {
      const address = toLowerCase(factoryContract.address);
      const eventSelector = factoryContract.eventSelector;

      const { id: factoryContractId } = await tx
        .insertInto("factoryContracts")
        .values({ chainId, address, eventSelector })
        // Note that we need to REPLACE here rather than IGNORE so that the
        // RETURNING clause works as expected (we need the ID of this row).
        .onConflict((oc) => oc.doUpdateSet({ chainId, address, eventSelector }))
        .returningAll()
        .executeTakeFirstOrThrow();

      const overlappingIntervals = await tx
        .selectFrom("childContractIntervals")
        .selectAll()
        .where("factoryContractId", "=", factoryContractId)
        .where(({ and, or, cmpr }) =>
          or([
            // Existing interval endBlock falls within new interval.
            and([
              cmpr("endBlock", ">=", startBlock - 1n),
              cmpr("endBlock", "<=", endBlock + 1n),
            ]),
            // Existing interval startBlock falls within new interval.
            and([
              cmpr("startBlock", ">=", startBlock - 1n),
              cmpr("startBlock", "<=", endBlock + 1n),
            ]),
            // New interval is fully within existing interval.
            and([
              cmpr("startBlock", "<=", startBlock - 1n),
              cmpr("endBlock", ">=", endBlock + 1n),
            ]),
          ])
        )
        .execute();

      if (overlappingIntervals.length > 0) {
        await tx
          .deleteFrom("childContractIntervals")
          .where(
            "id",
            "in",
            overlappingIntervals.map((r) => r.id)
          )
          .execute();
      }

      await tx
        .insertInto("childContractIntervals")
        .values({
          factoryContractId,
          startBlock: bigIntMin([
            ...overlappingIntervals.map((r) => r.startBlock),
            startBlock,
          ]),
          endBlock: bigIntMax([
            ...overlappingIntervals.map((r) => r.endBlock),
            endBlock,
          ]),
          endBlockTimestamp: bigIntMax([
            ...overlappingIntervals.map((r) => r.endBlockTimestamp),
            endBlockTimestamp,
          ]),
        })
        .execute();
    }
  };

  /** CONTRACT READS */

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
      .onConflict((oc) => oc.doUpdateSet({ result }))
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
    fromTimestamp,
    toTimestamp,
    logFilters = [],
    factoryContracts = [],
    pageSize = 10_000,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
    logFilters?: {
      name: string;
      chainId: number;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    factoryContracts?: {
      chainId: number;
      address: Address;
      factoryEventSelector: Hex;
      child: {
        name: string;
        includeEventSelectors?: Hex[];
      };
      fromBlock?: number;
      toBlock?: number;
    }[];
    pageSize: number;
  }) {
    const eventSourceNames = [
      ...logFilters.map((f) => f.name),
      ...factoryContracts.map((f) => f.child.name),
    ];

    const baseQuery = this.db
      .with(
        "eventSources(eventSource_name)",
        () =>
          sql`( values ${sql.join(
            eventSourceNames.map((name) => sql`( ${sql.val(name)} )`)
          )} )`
      )
      .selectFrom("logs")
      .leftJoin("blocks", "blocks.hash", "logs.blockHash")
      .leftJoin("transactions", "transactions.hash", "logs.transactionHash")
      .innerJoin("eventSources", (join) => join.onTrue())
      .select([
        "eventSource_name",

        "logs.address as log_address",
        "logs.blockHash as log_blockHash",
        "logs.blockNumber as log_blockNumber",
        "logs.chainId as log_chainId",
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
      .where("blocks.timestamp", ">=", intToBlob(fromTimestamp))
      .where("blocks.timestamp", "<=", intToBlob(toTimestamp))
      .orderBy("blocks.timestamp", "asc")
      .orderBy("logs.chainId", "asc")
      .orderBy("blocks.number", "asc")
      .orderBy("logs.logIndex", "asc");

    const buildLogFilterCmprs = ({
      where,
      logFilter,
    }: {
      where: ExpressionBuilder<any, any>;
      logFilter: (typeof logFilters)[number];
    }) => {
      const { cmpr, or } = where;
      const cmprs = [];

      cmprs.push(cmpr("eventSource_name", "=", logFilter.name));
      cmprs.push(
        cmpr(
          "logs.chainId",
          "=",
          sql`cast (${sql.val(logFilter.chainId)} as integer)`
        )
      );

      if (logFilter.address) {
        // If it's an array of length 1, collapse it.
        const address =
          Array.isArray(logFilter.address) && logFilter.address.length === 1
            ? logFilter.address[0]
            : logFilter.address;
        if (Array.isArray(address)) {
          cmprs.push(or(address.map((a) => cmpr("logs.address", "=", a))));
        } else {
          cmprs.push(cmpr("logs.address", "=", address));
        }
      }

      if (logFilter.topics) {
        for (const idx_ of range(0, 4)) {
          const idx = idx_ as 0 | 1 | 2 | 3;
          // If it's an array of length 1, collapse it.
          const raw = logFilter.topics[idx] ?? null;
          if (raw === null) continue;
          const topic = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
          if (Array.isArray(topic)) {
            cmprs.push(or(topic.map((a) => cmpr(`logs.topic${idx}`, "=", a))));
          } else {
            cmprs.push(cmpr(`logs.topic${idx}`, "=", topic));
          }
        }
      }

      if (logFilter.fromBlock) {
        cmprs.push(
          cmpr(
            "blocks.number",
            ">=",
            sql`cast (${sql.val(intToBlob(logFilter.fromBlock))} as blob)`
          )
        );
      }

      if (logFilter.toBlock) {
        cmprs.push(
          cmpr(
            "blocks.number",
            "<=",
            sql`cast (${sql.val(intToBlob(logFilter.toBlock))} as blob)`
          )
        );
      }

      return cmprs;
    };

    const buildFactoryContractCmprs = ({
      where,
      factoryContract,
    }: {
      where: ExpressionBuilder<any, any>;
      factoryContract: (typeof factoryContracts)[number];
    }) => {
      const { cmpr, selectFrom } = where;
      const cmprs = [];

      cmprs.push(cmpr("eventSource_name", "=", factoryContract.child.name));
      cmprs.push(
        cmpr(
          "logs.chainId",
          "=",
          sql`cast (${sql.val(factoryContract.chainId)} as integer)`
        )
      );

      cmprs.push(
        cmpr(
          "logs.address",
          "in",
          selectFrom("childContracts")
            .select("address")
            .where(
              "childContracts.factoryContractId",
              "=",
              selectFrom("factoryContracts")
                .select("id")
                .where(
                  "factoryContracts.chainId",
                  "=",
                  sql`cast (${sql.val(factoryContract.chainId)} as integer)`
                )
                .where("factoryContracts.address", "=", factoryContract.address)
                .where(
                  "factoryContracts.eventSelector",
                  "=",
                  factoryContract.factoryEventSelector
                )
            )
        )
      );

      if (factoryContract.fromBlock) {
        cmprs.push(
          cmpr(
            "blocks.number",
            ">=",
            sql`cast (${sql.val(intToBlob(factoryContract.fromBlock))} as blob)`
          )
        );
      }

      if (factoryContract.toBlock) {
        cmprs.push(
          cmpr(
            "blocks.number",
            "<=",
            sql`cast (${sql.val(intToBlob(factoryContract.toBlock))} as blob)`
          )
        );
      }

      return cmprs;
    };

    // Get full log objects, including the includeEventSelectors clause.
    const includedLogsBaseQuery = baseQuery
      .where((where) => {
        const { cmpr, and, or } = where;
        const logFilterCmprs = logFilters.map((logFilter) => {
          const cmprs = buildLogFilterCmprs({ where, logFilter });
          if (logFilter.includeEventSelectors) {
            cmprs.push(
              or(
                logFilter.includeEventSelectors.map((t) =>
                  cmpr("logs.topic0", "=", t)
                )
              )
            );
          }
          return and(cmprs);
        });

        const factoryContractCmprs = factoryContracts.map((factoryContract) => {
          const cmprs = buildFactoryContractCmprs({ where, factoryContract });
          if (factoryContract.child.includeEventSelectors) {
            cmprs.push(
              or(
                factoryContract.child.includeEventSelectors.map((t) =>
                  cmpr("logs.topic0", "=", t)
                )
              )
            );
          }
          return and(cmprs);
        });

        return or([...logFilterCmprs, ...factoryContractCmprs]);
      })
      .orderBy("blocks.timestamp", "asc")
      .orderBy("logs.chainId", "asc")
      .orderBy("blocks.number", "asc")
      .orderBy("logs.logIndex", "asc");

    // Get total count of matching logs, grouped by log filter and event selector.
    const eventCountsQuery = baseQuery
      .clearSelect()
      .select([
        "eventSource_name",
        "logs.topic0",
        this.db.fn.count("logs.id").as("count"),
      ])
      .where((where) => {
        const { and, or } = where;

        // NOTE: Not adding the includeEventSelectors clause here.
        const logFilterCmprs = logFilters.map((logFilter) =>
          and(buildLogFilterCmprs({ where, logFilter }))
        );

        const factoryContractCmprs = factoryContracts.map((factoryContract) =>
          and(buildFactoryContractCmprs({ where, factoryContract }))
        );

        return or([...logFilterCmprs, ...factoryContractCmprs]);
      })
      .groupBy(["eventSource_name", "logs.topic0"]);

    // Fetch the event counts once and include it in every response.
    const eventCountsRaw = await eventCountsQuery.execute();
    const eventCounts = eventCountsRaw.map((c) => ({
      eventSourceName: String(c.eventSource_name),
      selector: c.topic0 as Hex,
      count: Number(c.count),
    }));

    let cursor:
      | {
          timestamp: Buffer;
          chainId: number;
          blockNumber: Buffer;
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
          const { timestamp, chainId, blockNumber, logIndex } = cursor!;
          return and([
            cmpr("blocks.timestamp", ">=", timestamp),
            or([
              cmpr("blocks.timestamp", ">", timestamp),
              and([
                cmpr("logs.chainId", ">=", chainId),
                or([
                  cmpr("logs.chainId", ">", chainId),
                  and([
                    cmpr("blocks.number", ">=", blockNumber),
                    or([
                      cmpr("blocks.number", ">", blockNumber),
                      cmpr("logs.logIndex", ">", logIndex),
                    ]),
                  ]),
                ]),
              ]),
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
          eventSourceName: row.eventSource_name,
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
          eventSourceName: string;
          log: Log;
          block: Block;
          transaction: Transaction;
        };
      });

      const lastRow = requestedLogs[requestedLogs.length - 1];
      if (lastRow) {
        cursor = {
          timestamp: lastRow.block_timestamp!,
          chainId: lastRow.log_chainId,
          blockNumber: lastRow.block_number!,
          logIndex: lastRow.log_logIndex,
        };
      }

      const lastEventBlockTimestamp = lastRow?.block_timestamp;
      const pageEndsAtTimestamp = lastEventBlockTimestamp
        ? Number(blobToBigInt(lastEventBlockTimestamp))
        : toTimestamp;

      yield {
        events,
        metadata: {
          pageEndsAtTimestamp,
          counts: eventCounts,
        },
      };

      if (events.length < pageSize) break;
    }
  }
}
