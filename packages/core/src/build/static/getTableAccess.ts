import crypto from "node:crypto";
import type { StoreMethod } from "@/types/model.js";
import { dedupe } from "@ponder/common";
import { getHelperFunctions } from "./getHelperFunctions.js";
import { getIndexingFunctions } from "./getIndexingFunctions.js";
import { getNodeHash } from "./getNodeHash.js";
import { getTableReferences } from "./getTableReferences.js";
import { parseFiles } from "./parseFiles.js";
import { storeMethodAccess } from "./storeMethodAccess.js";

export type TableAccess = {
  [indexingFunctionKey: string]: {
    access: {
      tableName: string;
      storeMethod: StoreMethod;
    }[];
    hash: string;
  };
};

type HelperFunctionAccess = {
  functionName: string;
  /** Intermediate type for table name that encodes whether a valid tableName was found or not. */
  tableName: ReturnType<typeof getTableReferences>[number]["tableName"];
  storeMethod: StoreMethod;
}[];

export const getTableAccess = ({
  tableNames,
  filePaths,
}: {
  tableNames: string[];
  filePaths: string[];
}) => {
  const tableAccess = {} as TableAccess;

  const addToTableAccess = ({
    storeMethod,
    tableName,
    indexingFunctionKey,
  }: {
    storeMethod: StoreMethod;
    tableName: ReturnType<typeof getTableReferences>[number]["tableName"];
    indexingFunctionKey: string;
  }) => {
    if (tableName.matched) {
      tableAccess[indexingFunctionKey].access.push({
        tableName: tableName.table,
        storeMethod,
      });
    } else {
      for (const tableName of tableNames) {
        tableAccess[indexingFunctionKey].access.push({
          tableName,
          storeMethod,
        });
      }
    }
  };

  const files = parseFiles({ filePaths });

  // Find helper functions and what tables they access.
  const helperFunctions = files.flatMap((file) => getHelperFunctions({ file }));
  const helperFunctionAccess: HelperFunctionAccess = [];

  for (const { functionName, bodyNode } of helperFunctions) {
    const tableReferences = getTableReferences({
      node: bodyNode,
      tableNames,
    });

    for (const tableReference of tableReferences) {
      helperFunctionAccess.push({
        ...tableReference,
        functionName,
      });
    }
  }

  // Helper function hashes
  const helperFunctionHashes: { [functionName: string]: string } = {};
  for (const { functionName, bodyNode } of helperFunctions) {
    const hash = getNodeHash(bodyNode);
    helperFunctionHashes[functionName] = hash;
  }

  // Nested helper functions
  let helperFunctionsToSearch = helperFunctionAccess;
  let helperFunctionsFound: HelperFunctionAccess = [];

  for (let i = 0; i < 3; i++) {
    for (const { functionName, bodyNode } of helperFunctions) {
      const _matched = helperFunctionsToSearch
        .filter(
          (f) =>
            f.functionName !== functionName &&
            (bodyNode.find(`${f.functionName}`) ||
              bodyNode.find(`$$$.${f.functionName}`)),
        )
        .map((nest) => ({ ...nest, functionName }));

      helperFunctionsFound.push(..._matched);
    }
    helperFunctionAccess.push(...helperFunctionsFound);
    helperFunctionsToSearch = helperFunctionsFound;
    helperFunctionsFound = [];
  }

  // Find indexing functions and what tables + helper functions they access.
  const indexingFunctions = files.flatMap((file) =>
    getIndexingFunctions({ file }),
  );

  for (const { indexingFunctionKey, callbackNode } of indexingFunctions) {
    const tableReferences = getTableReferences({
      node: callbackNode,
      tableNames,
    });

    // Initialize table access
    tableAccess[indexingFunctionKey] = {
      access: [],
      hash: "",
    };

    const hash = getNodeHash(callbackNode);
    const _helperFunctionHashes: string[] = [];

    // Helper function invocation
    for (const {
      functionName,
      storeMethod,
      tableName,
    } of helperFunctionAccess) {
      if (
        callbackNode.find(`${functionName}`) ||
        callbackNode.find(`$$$.${functionName}`)
      ) {
        _helperFunctionHashes.push(helperFunctionHashes[functionName]!);

        addToTableAccess({ storeMethod, tableName, indexingFunctionKey });
      }
    }

    // Add hash
    tableAccess[indexingFunctionKey].hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          hash,
          helperFunctions: _helperFunctionHashes,
        }),
      )
      .digest("hex");

    // Store method invocation
    for (const { storeMethod, tableName } of tableReferences) {
      addToTableAccess({ storeMethod, tableName, indexingFunctionKey });
    }
  }

  // Dedupe tableAccess
  const dedupedTableAccess: TableAccess = {};

  for (const indexingFunctionKey of Object.keys(tableAccess)) {
    dedupedTableAccess[indexingFunctionKey] = {
      hash: tableAccess[indexingFunctionKey].hash,
      access: dedupe(
        tableAccess[indexingFunctionKey].access,
        (a) => `${a.tableName}_${a.storeMethod}`,
      ),
    };
  }

  return dedupedTableAccess;
};

export const getTableAccessInverse = (tableAccess: TableAccess) => {
  const tableAccessInverse: {
    [tableName: string]: {
      indexingFunctionKey: string;
      storeMethod: StoreMethod;
    }[];
  } = {};

  for (const [indexingFunctionKey, { access }] of Object.entries(tableAccess)) {
    for (const { tableName, storeMethod } of access) {
      if (tableAccessInverse[tableName] === undefined)
        tableAccessInverse[tableName] = [];

      tableAccessInverse[tableName].push({
        indexingFunctionKey,
        storeMethod,
      });
    }
  }

  return tableAccessInverse;
};

export const getTableAccessForTable = ({
  tableAccess,
  tableName,
}: { tableAccess: TableAccess; tableName: string }) => {
  const tableAccessInverse = getTableAccessInverse(tableAccess);

  return tableAccessInverse[tableName] === undefined
    ? []
    : tableAccessInverse[tableName];
};

export const isReadStoreMethod = (storeMethod: StoreMethod): boolean => {
  return storeMethodAccess[storeMethod].some((s) => s === "read");
};

export const isWriteStoreMethod = (storeMethod: StoreMethod): boolean => {
  return storeMethodAccess[storeMethod].some((s) => s === "write");
};

export function safeGetTableAccess({
  tableNames,
  filePaths,
}: {
  tableNames: string[];
  filePaths: string[];
}) {
  try {
    const result = getTableAccess({ tableNames, filePaths });
    return { success: true, data: result } as const;
  } catch (error_) {
    const error = error_ as Error;
    return { success: false, error } as const;
  }
}
