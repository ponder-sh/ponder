import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import type { HistoricalStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { DrizzleDb } from "./db.js";
import { convertToDrizzleTable, createDrizzleDb } from "./runtime.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const createDb = (database: DatabaseService) => {
  if (database instanceof SqliteDatabaseService) {
    return createDrizzleDb({
      kind: database.kind,
      database: database.userDatabase,
    }) as unknown as DrizzleDb;
  } else {
    return createDrizzleDb({
      kind: database.kind,
      pool: database.readonlyPool,
    }) as unknown as DrizzleDb;
  }
};

test("runtime select", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({ tableName: "table", id: "kyle" });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(
      convertToDrizzleTable(
        "table",
        schema.table.table,
        context.databaseConfig,
      ),
    );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "kyle" });

  await cleanup();
});

test("select hex", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.hex(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({ tableName: "table", id: "0x1" });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(
      convertToDrizzleTable(
        "table",
        schema.table.table,
        context.databaseConfig,
      ),
    );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "0x01" });

  await cleanup();
});

test("select bigint", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.bigint(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({ tableName: "table", id: 1n });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(
      convertToDrizzleTable(
        "table",
        schema.table.table,
        context.databaseConfig,
      ),
    );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 1n });

  await cleanup();
});

test("select json", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      json: p.json(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({
    tableName: "table",
    id: "1",
    data: {
      json: {
        prop: 52,
      },
    },
  });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(
      convertToDrizzleTable(
        "table",
        schema.table.table,
        context.databaseConfig,
      ),
    );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "1", json: { prop: 52 } });

  await cleanup();
});

test("select enum", async (context) => {
  const schema = createSchema((p) => ({
    en: p.createEnum(["hi", "low"]),
    table: p.createTable({
      id: p.string(),
      en: p.enum("en"),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({
    tableName: "table",
    id: "1",
    data: { en: "hi" },
  });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(
      convertToDrizzleTable(
        "table",
        schema.table.table,
        context.databaseConfig,
      ),
    );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "1", en: "hi" });

  await cleanup();
});

test("select with join", async (context) => {
  const schema = createSchema((p) => ({
    account: p.createTable({
      id: p.hex(),
      name: p.string(),
      age: p.int(),
    }),
    nft: p.createTable({
      id: p.bigint(),
      owner: p.hex().references("account.id"),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({
    tableName: "account",
    id: "0x1",
    data: {
      name: "kyle",
      age: 52,
    },
  });
  await indexingStore.create({
    tableName: "nft",
    id: 10n,
    data: { owner: "0x1" },
  });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const account = convertToDrizzleTable(
    "account",
    schema.account.table,
    context.databaseConfig,
  );
  const nft = convertToDrizzleTable(
    "nft",
    schema.nft.table,
    context.databaseConfig,
  );

  const rows = await db
    .select()
    .from(account)
    // @ts-ignore
    .fullJoin(nft, eq(account.id, nft.owner));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    account: { id: "0x01", name: "kyle", age: 52 },
    nft: { id: 10n, owner: "0x01" },
  });

  await cleanup();
});
