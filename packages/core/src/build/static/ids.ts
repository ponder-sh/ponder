import crypto from "crypto";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { dedupe } from "@/utils/dedupe.js";
import type { TableAccess } from "./parseAst.js";

export type FunctionIds = { [func: string]: string };
export type TableIds = { [table: string]: string };

export const getIds = ({
  sources,
  tableAccess,
  schema,
}: { sources: Source[]; schema: Schema; tableAccess: TableAccess }) => {
  const functionInputs: {
    [key: string]: {
      astHash: string;
      sources: Source[];
    };
  } = {};
  const tableInputs: {
    [key: string]: {
      schema: Schema["tables"][string];
    };
  } = {};

  // Dedupe indexing function keys
  const seenKeys: Set<string> = new Set();
  const tableWrites = tableAccess
    .filter((t) => t.access === "write")
    .filter((t) => {
      if (seenKeys.has(t.indexingFunctionKey)) {
        return false;
      } else {
        seenKeys.add(t.indexingFunctionKey);
        return true;
      }
    });

  // Build functions
  for (const { hash, indexingFunctionKey } of tableWrites) {
    const contractName = indexingFunctionKey.split(":")[0]!;
    const tableSources = sources.filter((s) => s.contractName === contractName);

    functionInputs[indexingFunctionKey] = {
      astHash: hash,
      sources: tableSources,
    };
  }

  // Build tables
  for (const tableName of Object.keys(schema.tables)) {
    tableInputs[tableName] = {
      schema: resolveSchema(schema.tables[tableName], schema.enums),
    };
  }

  const functionIds: FunctionIds = {};
  const tableIds: TableIds = {};

  // Build function IDs
  for (const [indexingFunctionKey, { astHash, sources }] of Object.entries(
    functionInputs,
  )) {
    // Find tables written to and read from?
    const tableNames = tableAccess
      .filter(
        (t) =>
          t.access === "write" && t.indexingFunctionKey === indexingFunctionKey,
      )
      .map((t) => t.table);

    const tables = dedupe(tableNames).map(
      (tableName) => tableInputs[tableName],
    );

    functionIds[indexingFunctionKey] = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          indexingFunctionKey,
          astHash,
          sources,
          tables,
        }),
      )
      .digest("hex");
  }

  // Build table IDs
  for (const [tableName, { schema }] of Object.entries(tableInputs)) {
    const functionKeys = tableAccess
      .filter((t) => t.access === "write" && t.table === tableName)
      .map((t) => t.indexingFunctionKey);

    const functions = dedupe(functionKeys).map((key) => functionInputs[key]);

    tableIds[tableName] = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          tableName,
          schema,
          functions,
        }),
      )
      .digest("hex");
  }

  return { tableIds, functionIds };
};

/** Resolve the enum columns of a table. Remove "one" and "many" column. */
const resolveSchema = (
  table: Schema["tables"][string],
  enums: Schema["enums"],
) => {
  for (const [columnName, column] of Object.entries(table)) {
    if (isEnumColumn(column)) {
      const resolvedEnum = enums[column.type];
      Object.defineProperty(table[columnName], "resolved", resolvedEnum);
    } else if (isOneColumn(column) || isManyColumn(column)) {
      delete table[columnName];
    }
  }
  return table;
};
