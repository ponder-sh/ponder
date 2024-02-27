import type { StoreMethod } from "@/types/model.js";
import { getHelperFunctions } from "./getHelperFunctions.js";
import { getIndexingFunctions } from "./getIndexingFunctions.js";
import { getTableReferences } from "./getTableReferences.js";
import { parseFiles } from "./parseFiles.js";

export type TableAccess = {
  [indexingFunctionKey: string]: {
    tableName: string;
    storeMethod: StoreMethod;
  }[];
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
  indexingFunctionKeys: string[];
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
    if (tableAccess[indexingFunctionKey] === undefined)
      tableAccess[indexingFunctionKey] = [];

    if (tableName.matched) {
      tableAccess[indexingFunctionKey].push({
        tableName: tableName.table,
        storeMethod,
      });
    } else {
      for (const tableName of tableNames) {
        tableAccess[indexingFunctionKey].push({
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
        addToTableAccess({ storeMethod, tableName, indexingFunctionKey });
      }
    }

    // Store method invocation
    for (const { storeMethod, tableName } of tableReferences) {
      addToTableAccess({ storeMethod, tableName, indexingFunctionKey });
    }
  }

  // Dedupe tableAccess
  const dedupedTableAccess: TableAccess = {};

  for (const indexingFunctionKey of Object.keys(tableAccess)) {
    dedupedTableAccess[indexingFunctionKey] = [];
    const seen = new Set<string>();

    for (const { storeMethod, tableName } of tableAccess[indexingFunctionKey]) {
      const key = `${tableName}_${storeMethod}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedTableAccess[indexingFunctionKey].push({
          tableName,
          storeMethod,
        });
      }
    }
  }

  return dedupedTableAccess;
};
