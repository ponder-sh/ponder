import type { SgNode } from "@ast-grep/napi";
import { getHelperFunctions } from "./getHelperFunctions.js";
import { getIndexingFunctions } from "./getIndexingFunctions.js";
import { getTableReferences } from "./getTableReferences.js";
import { type ORMMethods, ormAccess } from "./orm.js";
import { parseFiles } from "./parseFiles.js";

export type TableAccess = {
  table: string;
  indexingFunctionKey: string;
  access: "read" | "write";
}[];

type HelperFunctionAccess = {
  functionName: string;
  method: ORMMethods;
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
    method: ORMMethods;
    tableName: ReturnType<typeof getTableReferences>[number]["tableName"];
    indexingFunctionKey: string;
  }) => {
    const accessArr = ormAccess[method];
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
  for (const { functionName, bodyNode } of helperFunctions) {
    const nestedHelperFunctions = helperFunctionAccess.filter(
      (f) => f.functionName !== functionName,
    );

    for (const nestedHelperFunction of nestedHelperFunctions) {
      if (
        bodyNode.find(`${nestedHelperFunction.functionName}`) ||
        bodyNode.find(`$$$.${nestedHelperFunction.functionName}`)
      ) {
        // const helperAccess = helperFunctionAccess.fil((h) => )
        helperFunctionAccess.push({
          ...nestedHelperFunction,
          functionName,
        });
      }
    }
  }

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
