import path from "path";
import url from "url";
import { expect, test } from "vitest";
import schema from "./_test/ponder.schema.js";
import { parseAst } from "./parseAst.js";

const tableNames = Object.keys(schema.tables);
const indexingFunctionKeys = ["C:Event1", "C:Event2", "C:Event3"];

test("basic", () => {
  const tableAccess = parseAst({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(url.fileURLToPath(import.meta.url), "..", "_test", "basic.ts"),
    ],
  });

  expect(tableAccess).toHaveLength(4);

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "read",
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "write",
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event2",
    access: "read",
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event2",
    access: "write",
    hash: expect.any(String),
  });
});

test("helper function", () => {
  const tableAccess = parseAst({
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

  expect(tableAccess).toHaveLength(6);

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "read",
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "write",
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event2",
    access: "read",
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event2",
    access: "write",
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event3",
    access: "read",
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event3",
    access: "write",
  });
});

test.skip("helper rename", () => {
  const tableAccess = parseAst({
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
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event1",
    access: "write",
    hash: expect.any(String),
  });
});

test("renamed variable", () => {
  const tableAccess = parseAst({
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

  expect(tableAccess).toHaveLength(6);

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event2",
    access: "read",
    hash: expect.any(String),
  });

  expect(tableAccess).toContainEqual({
    table: "Table1",
    indexingFunctionKey: "C:Event2",
    access: "write",
    hash: expect.any(String),
  });
});
