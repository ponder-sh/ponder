import path from "path";
import url from "url";
import { expect, test } from "vitest";
import { getTableAccess } from "./getTableAccess.js";
import schema from "./test/ponder.schema.js";

const tableNames = Object.keys(schema.tables);
const indexingFunctionKeys = ["C:Event1", "C:Event2", "C:Event3"];

test("basic", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "basic.ts"),
    ],
  });

  expect(tableAccess["C:Event1"].access).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);

  expect(tableAccess["C:Event2"].access).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);
});

test("helper function", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(
        url.fileURLToPath(import.meta.url),
        "..",
        "test",
        "helperFunc.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "util.ts"),
    ],
  });

  expect(tableAccess["C:Event1"].access).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);

  expect(tableAccess["C:Event2"].access).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);

  expect(tableAccess["C:Event3"].access).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);
});

test.skip("helper rename", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(
        url.fileURLToPath(import.meta.url),
        "..",
        "test",
        "helperFuncRename.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "util.ts"),
    ],
  });

  expect(tableAccess).toHaveLength(4);

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "read",
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "write",
  });
});

test("renamed variable", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(
        url.fileURLToPath(import.meta.url),
        "..",
        "test",
        "renameVar.ts",
      ),
    ],
  });

  // Unable to match on a table name, so fall back to all table names

  expect(tableAccess["C:Event2"].access).toStrictEqual([
    { tableName: "Table1", storeMethod: "upsert" },
    { tableName: "Table2", storeMethod: "upsert" },
    { tableName: "Table3", storeMethod: "upsert" },
  ]);
});

test("helper class", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(
        url.fileURLToPath(import.meta.url),
        "..",
        "test",
        "helperClass.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "util.ts"),
    ],
  });

  expect(tableAccess["C:Event1"].access).toStrictEqual([
    { tableName: "Table1", storeMethod: "upsert" },
  ]);
});

test("helper object", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(
        url.fileURLToPath(import.meta.url),
        "..",
        "test",
        "helperObject.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "util.ts"),
    ],
  });

  expect(tableAccess["C:Event1"].access).toStrictEqual([
    { tableName: "Table1", storeMethod: "upsert" },
  ]);
});

test("nested helper functions", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(
        url.fileURLToPath(import.meta.url),
        "..",
        "test",
        "helperNest.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "util.ts"),
    ],
  });
  expect(tableAccess["C:Event1"].access).toStrictEqual([
    { tableName: "Table1", storeMethod: "upsert" },
  ]);
});
