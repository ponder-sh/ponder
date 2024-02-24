import type { StoreMethod } from "@/types/model.js";
import type { SgNode } from "@ast-grep/napi";
import { storeMethodAccess } from "./storeMethodAccess.js";

/**
 * Returns the tables that are directly accessed inside of a given indexing function callback.
 */
export const getTableReferences = ({
  node,
  tableNames,
}: { node: SgNode; tableNames: string[] }): {
  storeMethod: StoreMethod;
  tableName: { matched: true; table: string } | { matched: false };
}[] => {
  const methodCalls = Object.keys(storeMethodAccess).map((storeMethod) => ({
    storeMethod: storeMethod as StoreMethod,
    nodes: node.findAll(`$TABLE.${storeMethod}($_)`),
  }));

  return methodCalls.flatMap((methodCall) => {
    const storeMethod = methodCall.storeMethod;

    return methodCall.nodes.map((n) => {
      // _table can often be "context.db.TABLE"
      const _table = n.getMatch("TABLE")!.text()!.split(".")!;
      const table = _table.length === 1 ? _table[0] : _table[_table.length - 1];

      const matched = tableNames.includes(table);

      return {
        storeMethod,
        tableName: matched ? { matched, table: table } : { matched },
      } as const;
    });
  });
};
