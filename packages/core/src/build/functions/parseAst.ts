import fs from "node:fs";
import path from "node:path";
import { SgNode, js, ts } from "@ast-grep/napi";

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

const parseTableReference = (
  node: SgNode,
  tableNames: string[],
): string | null => {
  // _table can often be "context.db.TABLE"
  const _table = node.getMatch("TABLE")!.text()!.split(".")!;
  const table = _table.length === 1 ? _table[0] : _table[_table.length - 1];

  const isIncluded = tableNames.includes(table);

  // Note: Null represents flag to say: "mark this function as fully dependent"
  return isIncluded ? table : null;
};

const findAllORMCalls = (root: SgNode) => {
  return Object.keys(ormFunctions).map((ormf) => ({
    method: ormf as keyof typeof ormFunctions,
    nodes: root.findAll(`$TABLE.${ormf}($_)`),
  }));
};

// const printNodes = (nodes: SgNode[]) => {
//   for (const node of nodes) {
//     console.log(node.text());
//   }
// };

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

  return [...arrowFuncName, ...funcDeclarName].filter(
    (name) => !!name,
  ) as string[];
};

export type TableAccess = {
  table: string;
  indexingFunctionKey: string;
  access: "read" | "write";
}[];

export const parseAst = ({
  tableNames,
  filePaths,
}: {
  tableNames: string[];
  indexingFunctionKeys: string[];
  filePaths: string[];
}) => {
  const tableAccessMap = [] as TableAccess;

  const helperFunctionAccess: Record<
    string,
    {
      table: string | null;
      method: keyof typeof ormFunctions;
      filePath: string;
    }[]
  > = {};

  const addToTableAccess = (
    table: string | null,
    indexingFunctionKey: string,
    method: keyof typeof ormFunctions,
  ) => {
    if (table) {
      for (const access of ormFunctions[method]) {
        tableAccessMap.push({
          table: table,
          indexingFunctionKey,
          access,
        });
      }
    } else {
      for (const table of tableNames) {
        for (const access of ormFunctions[method]) {
          tableAccessMap.push({
            table: table,
            indexingFunctionKey,
            access,
          });
        }
      }
    }
  };

  // Register all helper functions
  for (const filePath of filePaths) {
    const file = fs.readFileSync(filePath).toString();

    const isJs = path.extname(filePath) === ".js";
    const ast = isJs ? js.parse(file) : ts.parse(file);
    const root = ast.root();

    const ormCalls = findAllORMCalls(root);

    for (const call of ormCalls) {
      for (const node of call.nodes) {
        const helperNames = helperFunctionName(node);
        const table = parseTableReference(node, tableNames);

        for (const helperName of helperNames) {
          if (helperFunctionAccess[helperName] === undefined) {
            helperFunctionAccess[helperName] = [];
          }
          helperFunctionAccess[helperName].push({
            table,
            method: call.method,
            filePath,
          });
        }
      }
    }
  }

  // Build tableAccess
  for (const filePath of filePaths) {
    const file = fs.readFileSync(filePath).toString();

    const isJs = path.extname(filePath) === ".js";
    const ast = isJs ? js.parse(file) : ts.parse(file);
    const root = ast.root();

    const nodes = root
      .findAll('ponder.on("$NAME", $FUNC)')
      .concat(root.findAll("ponder.on('$NAME', $FUNC)"))
      .concat(root.findAll("ponder.on(`$NAME`, $FUNC)"));

    for (const node of nodes) {
      const indexingFunctionKey = getEventSignature(node);

      const funcNode = node.getMatch("FUNC")!;

      const ormCalls = findAllORMCalls(funcNode);

      // Search for calls to helper function
      for (const [name, helperFunctionState] of Object.entries(
        helperFunctionAccess,
      )) {
        if (funcNode.find(`${name}`) !== null) {
          for (const state of helperFunctionState) {
            addToTableAccess(state.table, indexingFunctionKey, state.method);
          }
        }
      }

      // Search for table access in indexing function
      for (const call of ormCalls) {
        for (const n of call.nodes) {
          const table = parseTableReference(n, tableNames);
          addToTableAccess(table, indexingFunctionKey, call.method);
        }
      }
    }
  }

  return tableAccessMap;
};
