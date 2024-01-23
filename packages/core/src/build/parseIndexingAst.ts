import fs from "node:fs";
import { SgNode, js } from "@ast-grep/napi";

const ormFunctions = {
  create: ["write"],
  update: ["read", "write"],
  upsert: ["read", "write"],
  delete: ["write"],
  findUnique: ["read"],
  findMany: ["read"],
  createMany: ["write"],
  updateMany: ["read", "write"],
} as const;

/**
 * Return the event signature, "{ContractName}:{EventName}", from the AST node.
 */
const getEventSignature = (node: SgNode) => {
  return node.getMatch("NAME")?.text()!;
};

/**
 * Return all nodes that call an ORM function on a table.
 */
const getTableReferences = (node: SgNode, table: string) => {
  return [
    ...(node.getMatch("FUNC")?.findAll(`${table}.$METHOD`) ?? []),
    ...(node.getMatch("FUNC")?.findAll(`$$$.${table}.$METHOD`) ?? []),
  ];
};

const parseTableReference = (
  node: SgNode,
): keyof typeof ormFunctions | undefined => {
  const method = node.getMatch("METHOD")?.text();

  if (method && Object.keys(ormFunctions).includes(method))
    return method as keyof typeof ormFunctions;

  return undefined;
};

export type TableAccess = {
  table: string;
  indexingFunctionKey: string;
  access: "read" | "write";
}[];

export const parseIndexingAst = ({
  tableNames,
  indexingFunctionKeys,
  filePaths,
}: {
  tableNames: string[];
  indexingFunctionKeys: string[];
  filePaths: string[];
}) => {
  const tableAccessMap = [] as TableAccess;

  for (const key of indexingFunctionKeys) {
    Object.defineProperty(tableAccessMap, key, {});
  }

  for (const filePath of filePaths) {
    const file = fs.readFileSync(filePath).toString();

    const ast = js.parse(file);
    const root = ast.root();
    const nodes = root.findAll('ponder.on("$NAME", $FUNC)');

    for (const node of nodes) {
      const indexingFunctionKey = getEventSignature(node);
      for (const table of tableNames) {
        const tableReferences = getTableReferences(node, table);
        for (const tableRef of tableReferences) {
          const method = parseTableReference(tableRef);

          if (method) {
            for (const access of ormFunctions[method]) {
              tableAccessMap.push({
                table,
                indexingFunctionKey,
                access,
              });
            }
          }
        }
      }
    }
  }

  return tableAccessMap;
};
