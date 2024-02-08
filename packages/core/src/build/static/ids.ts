import crypto from "crypto";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import { isBaseColumn, isEnumColumn } from "@/schema/utils.js";
import { dedupe } from "@/utils/dedupe.js";
import type { TableAccess } from "./parseAst.js";

export type FunctionIds = { [func: string]: string };
export type TableIds = { [table: string]: string };

type FunctionInputs = {
  [key: string]: {
    astHash: string;
    sources: object[];
  };
};
type TableInputs = {
  [key: string]: {
    schema: object;
  };
};

export const getIds = ({
  sources,
  tableAccess,
  schema,
}: { sources: Source[]; schema: Schema; tableAccess: TableAccess }) => {
  const functionInputs: FunctionInputs = {};
  const tableInputs: TableInputs = {};

  // Dedupe indexing function keys
  const seenKeys: Set<string> = new Set();
  const _keys = tableAccess.filter((t) => {
    if (seenKeys.has(t.indexingFunctionKey)) {
      return false;
    } else {
      seenKeys.add(t.indexingFunctionKey);
      return true;
    }
  });

  // Build function inputs
  for (const { hash, indexingFunctionKey } of _keys) {
    const contractName = indexingFunctionKey.split(":")[0]!;
    const tableSources = sources.filter((s) => s.contractName === contractName);

    functionInputs[indexingFunctionKey] = {
      astHash: hash,
      sources: tableSources,
    };
  }

  // Build table inputs
  for (const tableName of Object.keys(schema.tables)) {
    tableInputs[tableName] = {
      schema: resolveSchema(schema.tables[tableName], schema.enums),
    };
  }

  const functionIds: FunctionIds = {};
  const tableIds: TableIds = {};

  // Build function IDs
  for (const indexingFunctionKey of Object.keys(functionInputs)) {
    const { functions, tables } = resolveDependencies({
      name: indexingFunctionKey,
      type: "function",
      tableAccess,
    });

    functionIds[indexingFunctionKey] = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          name: indexingFunctionKey,
          type: "function",

          functions,
          tables,
          functionInputs: functions.map((f) => functionInputs[f]),
          tableInputs: tables.map((t) => tableInputs[t]),
        }),
      )
      .digest("hex");
  }

  // Build table IDs
  for (const tableName of Object.keys(tableInputs)) {
    const { functions, tables } = resolveDependencies({
      name: tableName,
      type: "table",
      tableAccess,
    });

    tableIds[tableName] = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          name: tableName,
          type: "table",

          functions,
          tables,
          functionInputs: functions.map((f) => functionInputs[f]),
          tableInputs: tables.map((t) => tableInputs[t]),
        }),
      )
      .digest("hex");
  }

  console.log({
    tableIds,
    functionIds,
  });

  return { tableIds, functionIds };
};

/**
 * Deterministically resolve all dependencies of a given function or table.
 */
const resolveDependencies = ({
  name,
  type,
  tableAccess,
}: {
  name: string;
  type: "function" | "table";
  tableAccess: TableAccess;
}): { functions: string[]; tables: string[] } => {
  const functions: string[] = [];
  const tables: string[] = [];

  const innerResolve = (name: string, type: "function" | "table") => {
    if (type === "function" && functions.includes(name)) return;
    if (type === "table" && tables.includes(name)) return;

    // Tables are dependent on all the functions that write to them
    if (type === "table") {
      tables.push(name);

      const functionNames = tableAccess
        .filter((t) => t.access === "write" && t.table === name)
        .map((t) => t.indexingFunctionKey);

      for (const functionName of dedupe(functionNames)) {
        innerResolve(functionName, "function");
      }
    }
    // Functions are dependent on all the tables that they read from and write to
    else {
      functions.push(name);

      const tableNames = tableAccess
        .filter((t) => t.indexingFunctionKey === name)
        .map((t) => t.table);

      for (const tableName of dedupe(tableNames)) {
        innerResolve(tableName, "table");
      }
    }
  };

  innerResolve(name, type);

  return { functions, tables };
};

/** Resolve the enum columns of a table. Remove "one" and "many" column. */
const resolveSchema = (
  table: Schema["tables"][string],
  enums: Schema["enums"],
): Object => {
  let resolved: object = {};

  for (const [columnName, column] of Object.entries(table)) {
    if (isEnumColumn(column)) {
      const resolvedEnum = enums[column.type];
      resolved = {
        ...resolved,
        [columnName]: {
          ...column,
          resolvedEnum,
        },
      };
    } else if (isBaseColumn(column)) {
      resolved = {
        ...resolved,
        [columnName]: {
          ...column,
        },
      };
    }
  }
  return table;
};
