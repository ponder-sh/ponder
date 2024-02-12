import path from "path";
import url from "url";
import { expect, test } from "vitest";
import { parseAst } from "./parseAst.js";
import schema from "./test/ponder.schema.js";

const tableNames = Object.keys(schema.tables);
const indexingFunctionKeys = ["C:Event1", "C:Event2", "C:Event3"];

test("basic", () => {
  const tableAccess = parseAst({
    tableNames,
    indexingFunctionKeys,
    filePaths: [
      path.join(url.fileURLToPath(import.meta.url), "..", "test", "basic.ts"),
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
});

test("helper function", () => {
  const tableAccess = parseAst({
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

  expect(tableAccess).toHaveLength(6);

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
  const tableAccess = parseAst({
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

  expect(tableAccess).toHaveLength(6);

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
});
