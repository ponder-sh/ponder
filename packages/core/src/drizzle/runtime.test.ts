import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { Context } from "@/hono/context.js";
import type { HistoricalStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { DrizzleDb } from "./db.js";
import { createDrizzleDb, createDrizzleTables } from "./runtime.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

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

  await indexingStore.create({ tableName: "table", id: "kyle" });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db.select().from(drizzleTables.table);

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

  await indexingStore.create({ tableName: "table", id: "0x1" });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db.select().from(drizzleTables.table);

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

  await indexingStore.create({ tableName: "table", id: 1n });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db.select().from(drizzleTables.table);

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

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db.select().from(drizzleTables.table);

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

  await indexingStore.create({
    tableName: "table",
    id: "1",
    data: { en: "hi" },
  });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db.select().from(drizzleTables.table);

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "1", en: "hi" });

  await cleanup();
});

test("select list", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      list: p.string().list(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  await indexingStore.create({
    tableName: "table",
    id: "1",
    data: {
      list: ["big", "dog"],
    },
  });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db.select().from(drizzleTables.table);

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "1", list: ["big", "dog"] });

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

  const db = createDrizzleDb(database) as unknown as DrizzleDb;

  const drizzleTables = createDrizzleTables(schema, database) as Context<
    typeof schema
  >["tables"];

  const rows = await db
    .select()
    .from(drizzleTables.account)
    .fullJoin(
      drizzleTables.nft,
      eq(drizzleTables.account.id, drizzleTables.nft.owner),
    );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    account: { id: "0x01", name: "kyle", age: 52 },
    nft: { id: 10n, owner: "0x01" },
  });

  await cleanup();
});
