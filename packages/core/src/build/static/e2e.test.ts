import path from "path";
import url from "url";
import { expect, test } from "vitest";
import schema from "./_test/ponder.schema.js";
import { getTableAccess } from "./getTableAccess.js";

const tableNames = Object.keys(schema.tables);
const indexingFunctionKeys = ["C:Event1", "C:Event2", "C:Event3"];

test("basic", () => {
  const tableAccess = getTableAccess({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "basic.ts"),
    ],
  });

  expect(tableAccess["C:Event1"]).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);

  expect(tableAccess["C:Event2"]).toStrictEqual([
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
        "_test",
        "helperFunc.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "util.ts"),
    ],
  });

  expect(tableAccess["C:Event1"]).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);

  expect(tableAccess["C:Event2"]).toStrictEqual([
    {
      tableName: "Table1",
      storeMethod: "upsert",
    },
  ]);

  expect(tableAccess["C:Event3"]).toStrictEqual([
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
        "_test",
        "helperFuncRename.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "util.ts"),
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
        "_test",
        "renameVar.ts",
      ),
    ],
  });

  // Unable to match on a table name, so fall back to all table names

  expect(tableAccess["C:Event2"]).toStrictEqual([
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
        "_test",
        "helperClass.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "util.ts"),
    ],
  });

  expect(tableAccess["C:Event1"]).toStrictEqual([
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
        "_test",
        "helperObject.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "util.ts"),
    ],
  });

  expect(tableAccess["C:Event1"]).toStrictEqual([
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
        "_test",
        "helperNest.ts",
      ),
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "util.ts"),
    ],
  });
  expect(tableAccess["C:Event1"]).toStrictEqual([
    { tableName: "Table1", storeMethod: "upsert" },
  ]);
});
