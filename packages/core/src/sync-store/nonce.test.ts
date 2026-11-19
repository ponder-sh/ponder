import fs from "node:fs";
import { eq, sql } from "drizzle-orm";
import { numberToHex, zeroAddress, zeroHash } from "viem";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildSchema } from "@/build/schema.js";
import { createDatabase, type Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import type { SyncTransaction } from "@/internal/types.js";
import { standardizeTransactions } from "@/rpc/actions.js";
import { syncTransactionToInternal } from "@/runtime/events.js";
import { encodeTransaction } from "./encode.js";
import { transactions } from "./schema.js";

const shutdown = createShutdown();
const common: Common = {
  options: buildOptions({
    cliOptions: {
      command: "start",
      config: "",
      root: "",
      logLevel: "silent",
      logFormat: "pretty",
      version: "0.0.0",
    },
  }),
  logger: createLogger({ level: "silent" }),
  metrics: new MetricsService(),
  shutdown,
  apiShutdown: shutdown,
  buildShutdown: shutdown,
};

common.options.command = "list";

function newDatabase(): Database {
  return createDatabase({
    common,
    namespace: { schema: "public", viewsSchema: undefined },
    preBuild: {
      databaseConfig: { kind: "pglite", options: { dataDir: "memory://" } },
      ordering: "multichain",
    },
    schemaBuild: {
      schema: {},
      statements: buildSchema({
        schema: {},
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });
}

let database: Database;
beforeAll(async () => {
  database = newDatabase();
  await database.migrateSync();
});
afterAll(() => shutdown.kill());

function transaction(nonce: bigint): SyncTransaction {
  return {
    blockHash: zeroHash,
    blockNumber: "0x1",
    from: zeroAddress,
    gas: "0x5208",
    gasPrice: "0x1",
    hash: zeroHash,
    input: "0x",
    nonce: numberToHex(nonce),
    r: "0x1",
    s: "0x1",
    to: zeroAddress,
    transactionIndex: "0x0",
    type: "0x0",
    v: "0x1",
    value: "0x0",
  };
}

for (const nonce of [
  0n,
  (1n << 31n) - 1n,
  1n << 31n,
  1n << 53n,
  (1n << 63n) - 1n,
  1n << 63n,
  12181359264278543502n,
  (1n << 64n) - 1n,
]) {
  test(`standardizeTransactions() accepts nonce ${nonce}`, () => {
    const input = transaction(nonce);
    expect(
      standardizeTransactions([input], {
        method: "eth_getBlockByNumber",
        params: ["0x1", true],
      })[0]!.nonce,
    ).toBe(numberToHex(nonce));
  });

  test(`encodeTransaction() preserves nonce ${nonce}`, () => {
    expect(
      encodeTransaction({ transaction: transaction(nonce), chainId: 1 }).nonce,
    ).toBe(nonce);
  });

  test(`syncTransactionToInternal() preserves nonce ${nonce}`, () => {
    expect(
      syncTransactionToInternal({ transaction: transaction(nonce) }).nonce,
    ).toBe(nonce);
  });

  test(`the RPC cache round-trips nonce ${nonce} exactly`, async () => {
    await database.syncQB.raw.delete(transactions);
    await database.syncQB.raw
      .insert(transactions)
      .values(
        encodeTransaction({ transaction: transaction(nonce), chainId: 1 }),
      );
    expect(
      await database.syncQB.raw
        .select({ nonce: transactions.nonce })
        .from(transactions)
        .where(eq(transactions.chainId, 1n)),
    ).toEqual([{ nonce }]);
  });
}

test("Tempo type 0x76 expiring nonces survive the RPC, cache, and event pipeline", async () => {
  const nonce = 12181359264278543502n;
  const input = {
    ...transaction(nonce),
    type: "0x76" as const,
    nonceKey: numberToHex((1n << 256n) - 1n),
    validBefore: "0x70000000",
  };
  // Model the raw RPC boundary: viem does not declare Tempo's transaction type.
  const [standardized] = standardizeTransactions(
    [input as unknown as SyncTransaction],
    {
      method: "eth_getBlockByNumber",
      params: ["0x1", true],
    },
  );
  await database.syncQB.raw.delete(transactions);
  await database.syncQB.raw
    .insert(transactions)
    .values(encodeTransaction({ transaction: standardized!, chainId: 1 }));
  expect(
    await database.syncQB.raw
      .select({ nonce: transactions.nonce })
      .from(transactions),
  ).toEqual([{ nonce }]);
  expect(
    syncTransactionToInternal({ transaction: standardized! }),
  ).toMatchObject({ type: "0x76", nonce });
});

async function createPreviousCache(database: Database) {
  const source = fs.readFileSync(
    new URL("./sql/ponder_rpc_cache_1/create.sql", import.meta.url),
    "utf8",
  );
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim())
      await database.adminQB.raw.execute(sql.raw(statement));
  }
}

const cacheTables = [
  "blocks",
  "factories",
  "factory_addresses",
  "intervals",
  "logs",
  "rpc_request_results",
  "traces",
  "transaction_receipts",
  "transactions",
] as const;

// Exercise every column, including optional values, without losing numeric precision
// in the test driver's JSON decoder. The migration must preserve opaque cached data.
async function cacheRows(database: Database, schema: string, table: string) {
  const { rows: columns } = await database.adminQB.raw.execute<{
    column_name: string;
  }>(sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table}
    ORDER BY ordinal_position`);
  return database.adminQB.raw
    .execute(
      sql`SELECT ${sql.join(
        columns.map(
          ({ column_name }) =>
            sql`${sql.identifier(column_name)}::text AS ${sql.identifier(column_name)}`,
        ),
        sql`, `,
      )} FROM ${sql.identifier(schema)}.${sql.identifier(table)}`,
    )
    .then(({ rows }) => rows);
}

test("migrateSync() preserves all previous cache tables and factory sequence high-water mark", async () => {
  const database = newDatabase();
  await createPreviousCache(database);
  for (const table of cacheTables) {
    const { rows: columns } = await database.adminQB.raw.execute<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'ponder_rpc_cache_1' AND table_name = ${table}
      ORDER BY ordinal_position`);
    const values = columns.map((column, index) => {
      if (column.is_nullable === "YES" && index % 2 === 0) return null;
      if (column.column_name === "id" || column.column_name === "factory_id")
        return "7";
      if (column.data_type === "numeric")
        return (10n ** 65n + BigInt(index)).toString();
      if (column.data_type === "integer")
        return column.column_name === "nonce"
          ? "2147483647"
          : String(index + 1);
      if (column.data_type === "bigint") return String(index + 1);
      if (column.data_type === "ARRAY") return "{1,2}";
      if (column.data_type === "nummultirange") return "{[10,20),[30,40)}";
      return `0x${index.toString(16)}`;
    });
    await database.adminQB.raw.execute(sql`INSERT INTO
      ${sql.identifier("ponder_rpc_cache_1")}.${sql.identifier(table)}
      (${sql.join(
        columns.map(({ column_name }) => sql.identifier(column_name)),
        sql`, `,
      )})
      OVERRIDING SYSTEM VALUE VALUES (${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )})`);
  }
  // A deleted factory can leave the sequence ahead of MAX(id).
  await database.adminQB.raw.execute(
    sql`SELECT setval('ponder_rpc_cache_1.factories_id_seq', 1000, true)`,
  );
  const previous = await Promise.all(
    cacheTables.map((table) =>
      cacheRows(database, "ponder_rpc_cache_1", table),
    ),
  );

  await database.migrateSync();

  for (const [index, table] of cacheTables.entries()) {
    expect(await cacheRows(database, "ponder_rpc_cache_2", table)).toEqual(
      previous[index],
    );
  }
  expect(
    (
      await database.adminQB.raw.execute(sql`INSERT INTO ponder_rpc_cache_2.factories
    (fragment_id) VALUES ('next-factory') RETURNING id`)
    ).rows,
  ).toEqual([{ id: 1001 }]);

  const nonce = (1n << 64n) - 1n;
  await database.syncQB.raw.update(transactions).set({ nonce });
  await database.migrateSync();
  expect(
    await database.syncQB.raw
      .select({ nonce: transactions.nonce })
      .from(transactions),
  ).toEqual([{ nonce }]);
  expect(
    (
      await database.adminQB.raw.execute(
        sql`SELECT count(*)::int AS count FROM ponder_rpc_cache_2.factories`,
      )
    ).rows,
  ).toEqual([{ count: 2 }]);
});

test("migrateSync() preserves an unused factory sequence", async () => {
  const database = newDatabase();
  await createPreviousCache(database);
  await database.migrateSync();
  expect(
    (
      await database.adminQB.raw.execute(sql`INSERT INTO ponder_rpc_cache_2.factories
    (fragment_id) VALUES ('first-factory') RETURNING id`)
    ).rows,
  ).toEqual([{ id: 1 }]);
});
