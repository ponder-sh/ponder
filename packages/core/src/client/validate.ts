import type { Node, RawStmt } from "@pgsql/types";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
// @ts-ignore
import Parser from "pg-query-emscripten";

export const parseQuery = async (
  query: SQLWrapper,
): Promise<{ parse_tree: { stmts: RawStmt[] }; error: string | null }> => {
  const { parse } = await new Parser();
  const dialect = new PgDialect();
  return parse(dialect.sqlToQuery(query.getSQL()).sql);
};

type ValidatorNode<
  node extends Node extends infer T ? (T extends T ? keyof T : never) : never,
> = {
  node: node | (string & {});
  children: (node: Extract<Node, { [key in node]: unknown }>[node]) => Node[];
  validate: (node: Extract<Node, { [key in node]: unknown }>[node]) => void;
};
export const validateQuery = async (query: SQLWrapper) => {
  const parseResult = await parseQuery(query);

  if (parseResult.error !== null) {
    throw new Error("Invalid query");
  }

  if (parseResult.parse_tree.stmts.length === 0) {
    throw new Error("Invalid query");
  }

  if (parseResult.parse_tree.stmts.length > 1) {
    throw new Error("Invalid query");
  }

  const stmt = parseResult.parse_tree.stmts[0]!;

  if (stmt.stmt === undefined) {
    throw new Error("Invalid query");
  }

  const getNodeType = (node: Node) => Object.keys(node)[0]!;

  const validate = (node: Node) => {
    console.log(node);

    if (ALLOW_LIST.has(getNodeType(node)) === false) {
      throw new Error(`${getNodeType(node)} not supported`);
    }

    // @ts-ignore
    ALLOW_LIST.get(getNodeType(node))!.validate(node[getNodeType(node)]);

    for (const child of ALLOW_LIST.get(getNodeType(node))!.children(
      // @ts-ignore
      node[getNodeType(node)],
    )) {
      validate(child);
    }
  };

  validate(stmt.stmt);
};

/**
 * @see https://github.com/launchql/pgsql-parser/blob/f1df82ed4358e47c682e007bc5aa306b58f25514/packages/types/src/types.ts#L543
 */
const SELECT_STMT_VALIDATOR: ValidatorNode<"SelectStmt"> = {
  node: "SelectStmt",
  children: (node) => [
    ...(node.distinctClause ?? []),
    ...(node.intoClause ? [{ IntoClause: node.intoClause }] : []),
    ...(node.targetList ?? []),
    ...(node.fromClause ?? []),
    ...(node.whereClause ? [node.whereClause] : []),
    ...(node.groupClause ?? []),
    ...(node.havingClause ? [node.havingClause] : []),
    ...(node.windowClause ?? []),
    ...(node.valuesLists ?? []),
    ...(node.sortClause ?? []),
    ...(node.limitOffset ? [node.limitOffset] : []),
    ...(node.limitCount ? [node.limitCount] : []),
    ...(node.lockingClause ?? []),
    ...(node.withClause ? [{ WithClause: node.withClause }] : []),
    ...(node.larg ? [{ SelectStmt: node.larg }] : []),
    ...(node.rarg ? [{ SelectStmt: node.rarg }] : []),
  ],
  validate: (node) => {
    if (node.lockingClause) {
      throw new Error("Invalid query");
    }
  },
};

/**
 * @see https://github.com/launchql/pgsql-parser/blob/f1df82ed4358e47c682e007bc5aa306b58f25514/packages/types/src/types.ts#L1262
 */
const RES_TARGET_VALIDATOR: ValidatorNode<"ResTarget"> = {
  node: "ResTarget",
  children: (node) => [
    ...(node.indirection ?? []),
    ...(node.val ? [node.val] : []),
  ],
  validate: () => true,
};

/**
 * @see https://github.com/launchql/pgsql-parser/blob/f1df82ed4358e47c682e007bc5aa306b58f25514/packages/types/src/types.ts#L1224
 */
const COLUMN_REF_VALIDATOR: ValidatorNode<"ColumnRef"> = {
  node: "ColumnRef",
  children: (node) => [...(node.fields ?? [])],
  validate: () => true,
};

/**
 * @see https://github.com/launchql/pgsql-parser/blob/f1df82ed4358e47c682e007bc5aa306b58f25514/packages/types/src/types.ts#L1248
 */
const A_STAR_VALIDATOR: ValidatorNode<"A_Star"> = {
  node: "A_Star",
  children: () => [],
  validate: () => true,
};

/**
 * @see https://github.com/launchql/pgsql-parser/blob/f1df82ed4358e47c682e007bc5aa306b58f25514/packages/types/src/types.ts#L42
 */
const RANGE_VAR_VALIDATOR: ValidatorNode<"RangeVar"> = {
  node: "RangeVar",
  children: (node) => [...(node.alias ? [{ Alias: node.alias }] : [])],
  validate: () => true,
};

// with clause
// alias

const ALLOW_LIST = new Map(
  [
    SELECT_STMT_VALIDATOR,
    RES_TARGET_VALIDATOR,
    COLUMN_REF_VALIDATOR,
    A_STAR_VALIDATOR,
    RANGE_VAR_VALIDATOR,
  ].map((node) => [node.node, node]),
);
