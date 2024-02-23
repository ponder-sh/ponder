import type { StoreMethods } from "@/types/model.js";
import type { SgNode } from "@ast-grep/napi";
import { storeMethodAccess } from "./orm.js";

/**
 * Returns the tables that are directly accessed inside of a given indexing function callback.
 */
export const getTableReferences = ({
  node,
  tableNames,
}: { node: SgNode; tableNames: string[] }): {
  method: StoreMethods;
  tableName: { matched: true; table: string } | { matched: false };
}[] => {
  const ormCalls = Object.keys(storeMethodAccess).map((orm) => ({
    method: orm as StoreMethods,
    nodes: node.findAll(`$TABLE.${orm}($_)`),
  }));

  return ormCalls.flatMap((ormCall) => {
    const method = ormCall.method;

    return ormCall.nodes.map((n) => {
      // _table can often be "context.db.TABLE"
      const _table = n.getMatch("TABLE")!.text()!.split(".")!;
      const table = _table.length === 1 ? _table[0] : _table[_table.length - 1];

      const matched = tableNames.includes(table);

      return {
        method,
        tableName: matched ? { matched, table: table } : { matched },
      } as const;
    });
  });
};
