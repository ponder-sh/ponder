import SqliteDatabase from "better-sqlite3";
import { Kysely, Migrator, NO_MIGRATIONS, SqliteDialect } from "kysely";
import { expect, test } from "vitest";
import { type Database, type InsertableBlock } from "./schema";
import { migrationProvider } from "./migrations";
import { RpcBlock } from "viem";
import { formatRpcBlock } from "./formatters";

const buildDb = () => {
  const database = SqliteDatabase(":memory:");
  database.pragma("journal_mode = WAL");
  database.defaultSafeIntegers(true);
  return new Kysely<Database>({
    dialect: new SqliteDialect({ database }),
  });
};

const buildMigrator = ({ db }: { db: Kysely<any> }) =>
  new Migrator({ db, provider: migrationProvider });

const setup = async () => {
  const db = buildDb();
  const migrator = buildMigrator({ db });

  const { error } = await migrator.migrateToLatest();
  expect(error).toBeUndefined();

  return { db, migrator };
};

test("migrations", async () => {
  const db = buildDb();
  const migrator = buildMigrator({ db });

  const { error: migrateUpError } = await migrator.migrateToLatest();
  expect(migrateUpError).toBeUndefined();

  const { error: migrateDownError } = await migrator.migrateTo(NO_MIGRATIONS);
  expect(migrateDownError).toBeUndefined();
});

const rpcBlock: RpcBlock = {
  baseFeePerGas: "0x0",
  difficulty: "0x2d3a678cddba9b",
  extraData: "0x",
  gasLimit: "0x1c9c347",
  gasUsed: "0x0",
  hash: "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  logsBloom:
    "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  miner: "0x0000000000000000000000000000000000000000",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  nonce: "0x0000000000000000",
  number: "0xec6fc6",
  parentHash:
    "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
  receiptsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  sealFields: [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x0000000000000000",
  ],
  sha3Uncles:
    "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  size: "0x208",
  stateRoot:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  timestamp: "0x63198f6f",
  totalDifficulty: "0x1",
  transactions: [],
  transactionsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  uncles: [],
};

test("insert block", async () => {
  const { db } = await setup();

  const block = formatRpcBlock({ block: rpcBlock }) as InsertableBlock;
  block.chainId = 1;
  block.finalized = 1;

  await db.insertInto("blocks").values(block).execute();

  const resultBlock = await db
    .selectFrom("blocks")
    .selectAll()
    .where("hash", "=", rpcBlock.hash)
    .executeTakeFirst();

  expect(resultBlock).toMatchInlineSnapshot(`
    {
      "baseFeePerGas": 0n,
      "chainId": 1n,
      "difficulty": 12730590371363483n,
      "extraData": "0x",
      "finalized": 1n,
      "gasLimit": 29999943n,
      "gasUsed": 0n,
      "hash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "logsBloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "miner": "0x0000000000000000000000000000000000000000",
      "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "nonce": "0x0000000000000000",
      "number": 15495110n,
      "parentHash": "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
      "receiptsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
      "size": 520n,
      "stateRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "timestamp": 1662619503n,
      "totalDifficulty": 1n,
      "transactionsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    }
  `);
});
