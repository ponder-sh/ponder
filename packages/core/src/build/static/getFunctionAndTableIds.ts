import crypto from "crypto";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import { isBaseColumn, isEnumColumn } from "@/schema/utils.js";
import { dedupe } from "@ponder/common";
import type { IndexingFunctions } from "../functions/functions.js";
import {
  type TableAccess,
  getTableAccessForTable,
  isWriteStoreMethod,
} from "./getTableAccess.js";

export const HASH_VERSION = 3;

export type FunctionIds = { [func: string]: string };
export type TableIds = { [table: string]: string };

type FunctionInputs = {
  [indexingFunctionKey: string]: {
    astHash: string;
    sources: object[];
  };
};
type TableInputs = {
  [tableName: string]: {
    schema: object;
  };
};

type Identifier = {
  name: string;
  type: "table" | "function";
  version: number;

  functions: string[];
  tables: string[];

  functionInputs: FunctionInputs[string][];
  tableInputs: TableInputs[string][];
};

export const getFunctionAndTableIds = ({
  sources,
  tableAccess,
  schema,
  indexingFunctions,
}: {
  sources: Source[];
  schema: Schema;
  tableAccess: TableAccess;
  indexingFunctions: IndexingFunctions;
}) => {
  const functionInputs: FunctionInputs = {};
  const tableInputs: TableInputs = {};

  // Build function inputs
  for (const [indexingFunctionKey, { hash }] of Object.entries(tableAccess)) {
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
  for (const sourceName of Object.keys(indexingFunctions)) {
    for (const eventName of Object.keys(indexingFunctions[sourceName])) {
      const indexingFunctionKey = `${sourceName}:${eventName}`;

      const { functions, tables } = resolveDependencies({
        name: indexingFunctionKey,
        type: "function",
        tableAccess,
      });

      functionIds[indexingFunctionKey] = hashIdentifier({
        name: indexingFunctionKey,
        type: "function",

        functions,
        tables,
        functionInputs: functions.map((f) => functionInputs[f]),
        tableInputs: tables.map((t) => tableInputs[t]),
      });
    }
  }

  // Build table IDs
  for (const tableName of Object.keys(schema.tables)) {
    const { functions, tables } = resolveDependencies({
      name: tableName,
      type: "table",
      tableAccess,
    });

    tableIds[tableName] = hashIdentifier({
      name: tableName,
      type: "table",

      functions,
      tables,
      functionInputs: functions.map((f) => functionInputs[f]),
      tableInputs: tables.map((t) => tableInputs[t]),
    });
  }

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

      const functionNames = getTableAccessForTable({
        tableAccess,
        tableName: name,
      })
        .filter((t) => isWriteStoreMethod(t.storeMethod))
        .map((t) => t.indexingFunctionKey);

      for (const functionName of dedupe(functionNames)) {
        innerResolve(functionName, "function");
      }
    }
    // Functions are dependent on all the tables that they read from and write to
    else {
      functions.push(name);

      const tableNames = tableAccess[name].access.map((t) => t.tableName);

      for (const tableName of dedupe(tableNames)) {
        innerResolve(tableName, "table");
      }
    }
  };

  innerResolve(name, type);

  return { functions, tables };
};

/** Resolve the enum columns of a table. Remove "one" and "many" columns. */
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

const hashIdentifier = (schema: Omit<Identifier, "version">) => {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ ...schema, version: HASH_VERSION }))
    .digest("hex")
    .slice(0, 10);
};

export function safeGetFunctionAndTableIds({
  sources,
  tableAccess,
  schema,
  indexingFunctions,
}: {
  sources: Source[];
  schema: Schema;
  tableAccess: TableAccess;
  indexingFunctions: IndexingFunctions;
}) {
  try {
    const result = getFunctionAndTableIds({
      sources,
      schema,
      tableAccess,
      indexingFunctions,
    });
    return { success: true, data: result } as const;
  } catch (error_) {
    const error = error_ as Error;
    error.stack = undefined;
    return { success: false, error } as const;
  }
}
