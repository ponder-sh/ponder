import type { StoreMethods } from "@/types/model.js";
import { getHelperFunctions } from "./getHelperFunctions.js";
import { getIndexingFunctions } from "./getIndexingFunctions.js";
import { getTableReferences } from "./getTableReferences.js";
import { storeMethodAccess } from "./orm.js";
import { parseFiles } from "./parseFiles.js";

export type TableAccess = {
  table: string;
  indexingFunctionKey: string;
  access: "read" | "write";
}[];

type HelperFunctionAccess = {
  functionName: string;
  method: StoreMethods;
  tableName: ReturnType<typeof getTableReferences>[number]["tableName"];
}[];

export const getTableAccess = ({
  tableNames,
  filePaths,
}: {
  tableNames: string[];
  indexingFunctionKeys: string[];
  filePaths: string[];
}) => {
  const tableAccess = [] as TableAccess;

  const addToTableAccess = ({
    method,
    tableName,
    indexingFunctionKey,
  }: {
    method: StoreMethods;
    tableName: ReturnType<typeof getTableReferences>[number]["tableName"];
    indexingFunctionKey: string;
  }) => {
    const accessArr = storeMethodAccess[method];
    if (tableName.matched) {
      for (const access of accessArr)
        tableAccess.push({
          table: tableName.table,
          indexingFunctionKey,
          access,
        });
    } else {
      for (const table of tableNames) {
        for (const access of accessArr)
          tableAccess.push({
            table,
            indexingFunctionKey,
            access,
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
  let helperFunctionsFound = [];

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
    for (const { functionName, method, tableName } of helperFunctionAccess) {
      if (
        callbackNode.find(`${functionName}`) ||
        callbackNode.find(`$$$.${functionName}`)
      ) {
        addToTableAccess({ method, tableName, indexingFunctionKey });
      }
    }

    // ORM function invocation
    for (const { method, tableName } of tableReferences) {
      addToTableAccess({ method, tableName, indexingFunctionKey });
    }
  }

  return tableAccess;
};
