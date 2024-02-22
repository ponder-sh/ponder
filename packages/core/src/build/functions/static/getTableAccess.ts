import { SgNode } from "@ast-grep/napi";
import { getHelperFunctions } from "./getHelperFunctions.js";
import { getIndexingFunctions } from "./getIndexingFunctions.js";
import { getTableReferences } from "./getTableReferences.js";
import { ormAccess } from "./orm.js";
import { parseFiles } from "./parseFiles.js";

const helperFunctionName = (node: SgNode) => {
  const arrowFuncAncestor = node
    .ancestors()
    .filter((n) => n.kind() === "arrow_function");

  const arrowFuncName = arrowFuncAncestor.map((f) =>
    f
      .prevAll()
      .find((a) => a.kind() === "identifier")
      ?.text(),
  );

  const funcDeclarAncestor = node
    .ancestors()
    .filter((n) => n.kind() === "function_declaration");

  const funcDeclarName = funcDeclarAncestor.map((f) =>
    f
      .children()
      .find((c) => c.kind() === "identifier")
      ?.text(),
  );

  const methodDeclarAncestor = node
    .ancestors()
    .filter((n) => n.kind() === "method_definition");

  const methodDeclarName = methodDeclarAncestor.map((m) =>
    m
      .children()
      .find((c) => c.kind() === "property_identifier")
      ?.text(),
  );

  return [...arrowFuncName, ...funcDeclarName, ...methodDeclarName].filter(
    (name) => !!name,
  ) as string[];
};

export type TableAccess = {
  table: string;
  indexingFunctionKey: string;
  access: "read" | "write";
}[];

export const getTableAccess = ({
  tableNames,
  filePaths,
}: {
  tableNames: string[];
  indexingFunctionKeys: string[];
  filePaths: string[];
}) => {
  const tableAccessMap = [] as TableAccess;

  // const helperFunctionAccess: Record<
  //   string,
  //   {
  //     table: string | null;
  //     method: keyof typeof ormFunctions;
  //     filePath: string;
  //   }[]
  // > = {};

  const addToTableAccess = ({
    method,
    tableName,
    indexingFunctionKey,
  }: ReturnType<typeof getTableReferences>[number] & {
    indexingFunctionKey: string;
  }) => {
    const accessArr = ormAccess[method];
    if (tableName.matched) {
      for (const access of accessArr)
        tableAccessMap.push({
          table: tableName.table,
          indexingFunctionKey,
          access,
        });
    } else {
      for (const table of tableNames) {
        for (const access of accessArr)
          tableAccessMap.push({
            table,
            indexingFunctionKey,
            access,
          });
      }
    }
  };

  // Register all helper functions
  // for (const filePath of filePaths) {
  //   const file = fs.readFileSync(filePath).toString();

  //   const isJs = path.extname(filePath) === ".js";
  //   const ast = isJs ? js.parse(file) : ts.parse(file);
  //   const root = ast.root();

  //   const ormCalls = findAllORMCalls(root);

  //   for (const call of ormCalls) {
  //     for (const node of call.nodes) {
  //       const helperNames = helperFunctionName(node);
  //       const table = parseTableReference(node, tableNames);

  //       for (const helperName of helperNames) {
  //         if (helperFunctionAccess[helperName] === undefined) {
  //           helperFunctionAccess[helperName] = [];
  //         }
  //         helperFunctionAccess[helperName].push({
  //           table,
  //           method: call.method,
  //           filePath,
  //         });
  //       }
  //     }
  //   }
  // }

  const files = parseFiles({ filePaths });

  for (const file of files) {
    getHelperFunctions({ file });
  }

  for (const file of files) {
    const indexingFunctions = getIndexingFunctions({ file });

    for (const { indexingFunctionKey, callbackNode } of indexingFunctions) {
      const tableReferences = getTableReferences({ callbackNode, tableNames });

      // Helper function invocation

      // ORM function invocation
      for (const { method, tableName } of tableReferences) {
        addToTableAccess({ method, tableName, indexingFunctionKey });
      }
    }
  }

  return tableAccessMap;
};
