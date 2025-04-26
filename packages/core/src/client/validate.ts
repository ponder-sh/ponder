import type { Node, RawStmt } from "@pgsql/types";

type ValidatorNode<
  node extends Node extends infer T ? (T extends T ? keyof T : never) : never,
> = {
  node: node | (string & {});
  children: (node: Extract<Node, { [key in node]: unknown }>[node]) => Node[];
  validate?: (node: Extract<Node, { [key in node]: unknown }>[node]) => void;
};

const getNodeType = (node: Node) => Object.keys(node)[0]!;

const ALLOW_CACHE = new Map<string, boolean>();

/**
 * Validate a SQL query.
 *
 * @param sql - SQL query
 * @param shouldValidateInnerNode - `true` if the properties of each ast node should be validated, else only the allow list is checked
 */
export const validateQuery = async (
  sql: string,
  shouldValidateInnerNode = true,
) => {
  // @ts-ignore
  const Parser = await import(/* webpackIgnore: true */ "pg-query-emscripten");
  const crypto = await import(/* webpackIgnore: true */ "node:crypto");

  if (sql.length > 5_000) {
    throw new Error("Invalid query");
  }

  const hash = crypto
    .createHash("sha256")
    .update(sql)
    .digest("hex")
    .slice(0, 10);

  if (shouldValidateInnerNode) {
    if (ALLOW_CACHE.has(hash)) {
      const result = ALLOW_CACHE.get(hash)!;

      ALLOW_CACHE.delete(hash);
      ALLOW_CACHE.set(hash, result);

      if (result) return;
      throw new Error("Invalid query");
    } else {
      ALLOW_CACHE.set(hash, false);
    }
  }

  const { parse } = await Parser.default();
  const parseResult = parse(sql) as {
    parse_tree: { stmts: RawStmt[] };
    error: string | null;
  };

  if (parseResult.error !== null) {
    throw new Error(parseResult.error);
  }

  if (parseResult.parse_tree.stmts.length === 0) {
    throw new Error("Invalid query");
  }

  if (parseResult.parse_tree.stmts.length > 1) {
    throw new Error("Multiple statements not supported");
  }

  const stmt = parseResult.parse_tree.stmts[0]!;

  if (stmt.stmt === undefined) {
    throw new Error("Invalid query");
  }

  const validate = (node: Node) => {
    if (ALLOW_LIST.has(getNodeType(node)) === false) {
      throw new Error(`${getNodeType(node)} not supported`);
    }

    if (shouldValidateInnerNode) {
      // @ts-ignore
      ALLOW_LIST.get(getNodeType(node))!.validate?.(node[getNodeType(node)]);
    }

    for (const child of ALLOW_LIST.get(getNodeType(node))!.children(
      // @ts-ignore
      node[getNodeType(node)],
    )) {
      validate(child);
    }
  };

  validate(stmt.stmt);

  if (shouldValidateInnerNode) {
    ALLOW_CACHE.set(hash, true);
    if (ALLOW_CACHE.size > 1_000_000) {
      const firstKey = ALLOW_CACHE.keys().next().value;
      if (firstKey) ALLOW_CACHE.delete(firstKey);
    }
  }
};

// https://github.com/launchql/pgsql-parser/blob/f1df82ed4358e47c682e007bc5aa306b58f25514/packages/types/src/types.ts#L38

const INTEGER_VALIDATOR: ValidatorNode<"Integer"> = {
  node: "Integer",
  children: () => [],
};

const FLOAT_VALIDATOR: ValidatorNode<"Float"> = {
  node: "Float",
  children: () => [],
};

const BOOLEAN_VALIDATOR: ValidatorNode<"Boolean"> = {
  node: "Boolean",
  children: () => [],
};

const STRING_VALIDATOR: ValidatorNode<"String"> = {
  node: "String",
  children: () => [],
};

const BIT_STRING_VALIDATOR: ValidatorNode<"BitString"> = {
  node: "BitString",
  children: () => [],
};

const LIST_VALIDATOR: ValidatorNode<"List"> = {
  node: "List",
  children: (node) => [...(node.items ?? [])],
};

const OID_LIST_VALIDATOR: ValidatorNode<"OidList"> = {
  node: "OidList",
  children: (node) => [...(node.items ?? [])],
};

const INT_LIST_VALIDATOR: ValidatorNode<"IntList"> = {
  node: "IntList",
  children: (node) => [...(node.items ?? [])],
};

const A_CONST_VALIDATOR: ValidatorNode<"A_Const"> = {
  node: "A_Const",
  children: () => [],
};

const ALIAS_VALIDATOR: ValidatorNode<"Alias"> = {
  node: "Alias",
  children: (node) => [...(node.colnames ?? [])],
};

const RANGE_VAR_VALIDATOR: ValidatorNode<"RangeVar"> = {
  node: "RangeVar",
  children: (node) => [...(node.alias ? [{ Alias: node.alias }] : [])],
  validate: (node) => {
    if (node.schemaname) {
      throw new Error("Schema name not supported");
    }

    if (node.relname && SYSTEM_TABLES.has(node.relname)) {
      throw new Error("System tables not supported");
    }
  },
};

const VAR_VALIDATOR: ValidatorNode<"Var"> = {
  node: "Var",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const PARAM_VALIDATOR: ValidatorNode<"Param"> = {
  node: "Param",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const AGGREF_VALIDATOR: ValidatorNode<"Aggref"> = {
  node: "Aggref",
  children: (node) => [
    ...(node.aggargtypes ?? []),
    ...(node.aggdirectargs ?? []),
    ...(node.args ?? []),
    ...(node.aggorder ?? []),
    ...(node.aggdistinct ?? []),
    ...(node.aggfilter ? [node.aggfilter] : []),
  ],
};

const GROUPING_FUNC_VALIDATOR: ValidatorNode<"GroupingFunc"> = {
  node: "GroupingFunc",
  children: (node) => [...(node.args ?? []), ...(node.refs ?? [])],
};

const WINDOW_FUNC_VALIDATOR: ValidatorNode<"WindowFunc"> = {
  node: "WindowFunc",
  children: (node) => [
    ...(node.args ?? []),
    ...(node.aggfilter ? [node.aggfilter] : []),
  ],
};

const NAMED_ARG_EXPR_VALIDATOR: ValidatorNode<"NamedArgExpr"> = {
  node: "NamedArgExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const OP_EXPR_VALIDATOR: ValidatorNode<"OpExpr"> = {
  node: "OpExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const DISTINCT_EXPR_VALIDATOR: ValidatorNode<"DistinctExpr"> = {
  node: "DistinctExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const NULL_IF_EXPR_VALIDATOR: ValidatorNode<"NullIfExpr"> = {
  node: "NullIfExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const SCALAR_ARRAY_OP_EXPR_VALIDATOR: ValidatorNode<"ScalarArrayOpExpr"> = {
  node: "ScalarArrayOpExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const BOOL_EXPR_VALIDATOR: ValidatorNode<"BoolExpr"> = {
  node: "BoolExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const FIELD_SELECT_VALIDATOR: ValidatorNode<"FieldSelect"> = {
  node: "FieldSelect",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const RELABEL_TYPE_VALIDATOR: ValidatorNode<"RelabelType"> = {
  node: "RelabelType",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const ARRAY_COERCE_EXPR_VALIDATOR: ValidatorNode<"ArrayCoerceExpr"> = {
  node: "ArrayCoerceExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
    ...(node.elemexpr ? [node.elemexpr] : []),
  ],
};

const CONVERT_ROWTYPE_EXPR_VALIDATOR: ValidatorNode<"ConvertRowtypeExpr"> = {
  node: "ConvertRowtypeExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const COLLATE_EXPR_VALIDATOR: ValidatorNode<"CollateExpr"> = {
  node: "CollateExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const CASE_EXPR_VALIDATOR: ValidatorNode<"CaseExpr"> = {
  node: "CaseExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
    ...(node.args ?? []),
    ...(node.defresult ? [node.defresult] : []),
  ],
};

const CASE_WHEN_VALIDATOR: ValidatorNode<"CaseWhen"> = {
  node: "CaseWhen",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.expr ? [node.expr] : []),
    ...(node.result ? [node.result] : []),
  ],
};

const CASE_TEST_EXPR_VALIDATOR: ValidatorNode<"CaseTestExpr"> = {
  node: "CaseTestExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const ARRAY_EXPR_VALIDATOR: ValidatorNode<"ArrayExpr"> = {
  node: "ArrayExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.elements ?? []),
  ],
};

const ROW_EXPR_VALIDATOR: ValidatorNode<"RowExpr"> = {
  node: "RowExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.args ?? []),
    ...(node.colnames ?? []),
  ],
};

const ROW_COMPARE_EXPR_VALIDATOR: ValidatorNode<"RowCompareExpr"> = {
  node: "RowCompareExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.opnos ?? []),
    ...(node.opfamilies ?? []),
    ...(node.inputcollids ?? []),
    ...(node.largs ?? []),
    ...(node.rargs ?? []),
  ],
};

const COALESC_EXPR_VALIDATOR: ValidatorNode<"CoalesceExpr"> = {
  node: "CoalesceExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const MIN_MAX_EXPR_VALIDATOR: ValidatorNode<"MinMaxExpr"> = {
  node: "MinMaxExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : []), ...(node.args ?? [])],
};

const SQL_VALUE_FUNCTION_VALIDATOR: ValidatorNode<"SQLValueFunction"> = {
  node: "SQLValueFunction",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const JSON_FORMAT_VALIDATOR: ValidatorNode<"JsonFormat"> = {
  node: "JsonFormat",
  children: () => [],
};

const JSON_RETURNING_VALIDATOR: ValidatorNode<"JsonReturning"> = {
  node: "JsonReturning",
  children: (node) => [...(node.format ? [{ JsonFormat: node.format }] : [])],
};

const JSON_VALUE_EXPR_VALIDATOR: ValidatorNode<"JsonValueExpr"> = {
  node: "JsonValueExpr",
  children: (node) => [
    ...(node.raw_expr ? [node.raw_expr] : []),
    ...(node.formatted_expr ? [node.formatted_expr] : []),
    ...(node.format ? [{ JsonFormat: node.format }] : []),
  ],
};

const JSON_CONSTRUCTOR_EXPR_VALIDATOR: ValidatorNode<"JsonConstructorExpr"> = {
  node: "JsonConstructorExpr",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.args ?? []),
    ...(node.func ? [node.func] : []),
    ...(node.coercion ? [node.coercion] : []),
    ...(node.returning ? [{ JsonReturning: node.returning }] : []),
  ],
};

const JSON_IS_PREDICATE_VALIDATOR: ValidatorNode<"JsonIsPredicate"> = {
  node: "JsonIsPredicate",
  children: (node) => [
    ...(node.expr ? [node.expr] : []),
    ...(node.format ? [{ JsonFormat: node.format }] : []),
  ],
};

const NULL_TEST_VALIDATOR: ValidatorNode<"NullTest"> = {
  node: "NullTest",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const BOOLEAN_TEST_VALIDATOR: ValidatorNode<"BooleanTest"> = {
  node: "BooleanTest",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const COERCE_TO_DOMAIN_VALIDATOR: ValidatorNode<"CoerceToDomain"> = {
  node: "CoerceToDomain",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.arg ? [node.arg] : []),
  ],
};

const COERCE_TO_DOMAIN_VALUE_VALIDATOR: ValidatorNode<"CoerceToDomainValue"> = {
  node: "CoerceToDomainValue",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const CURRENT_OF_EXPR_VALIDATOR: ValidatorNode<"CurrentOfExpr"> = {
  node: "CurrentOfExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const NEXT_VALUE_EXPR_VALIDATOR: ValidatorNode<"NextValueExpr"> = {
  node: "NextValueExpr",
  children: (node) => [...(node.xpr ? [node.xpr] : [])],
};

const INFERENCE_ELEM_VALIDATOR: ValidatorNode<"InferenceElem"> = {
  node: "InferenceElem",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.expr ? [node.expr] : []),
  ],
};

const TARGET_ENTRY_VALIDATOR: ValidatorNode<"TargetEntry"> = {
  node: "TargetEntry",
  children: (node) => [
    ...(node.xpr ? [node.xpr] : []),
    ...(node.expr ? [node.expr] : []),
  ],
};

const RANGE_TBL_REF_VALIDATOR: ValidatorNode<"RangeTblRef"> = {
  node: "RangeTblRef",
  children: () => [],
};

const JOIN_EXPR_VALIDATOR: ValidatorNode<"JoinExpr"> = {
  node: "JoinExpr",
  children: (node) => [
    ...(node.larg ? [node.larg] : []),
    ...(node.rarg ? [node.rarg] : []),
    ...(node.usingClause ?? []),
    ...(node.join_using_alias ? [{ Alias: node.join_using_alias }] : []),
    ...(node.quals ? [node.quals] : []),
    ...(node.alias ? [{ Alias: node.alias }] : []),
  ],
};

const FROM_EXPR_VALIDATOR: ValidatorNode<"FromExpr"> = {
  node: "FromExpr",
  children: (node) => [
    ...(node.fromlist ?? []),
    ...(node.quals ? [node.quals] : []),
  ],
};

const ON_CONFLICT_EXPR_VALIDATOR: ValidatorNode<"OnConflictExpr"> = {
  node: "OnConflictExpr",
  children: (node) => [
    ...(node.arbiterElems ?? []),
    ...(node.arbiterWhere ? [node.arbiterWhere] : []),
    ...(node.onConflictSet ?? []),
    ...(node.onConflictWhere ? [node.onConflictWhere] : []),
    ...(node.exclRelTlist ?? []),
  ],
};

const TYPE_NAME_VALIDATOR: ValidatorNode<"TypeName"> = {
  node: "TypeName",
  children: (node) => [
    ...(node.names ?? []),
    ...(node.typmods ?? []),
    ...(node.arrayBounds ?? []),
  ],
};

const COLUMN_REF_VALIDATOR: ValidatorNode<"ColumnRef"> = {
  node: "ColumnRef",
  children: (node) => [...(node.fields ?? [])],
};

const PARAM_REF_VALIDATOR: ValidatorNode<"ParamRef"> = {
  node: "ParamRef",
  children: () => [],
};

const A_EXPR_VALIDATOR: ValidatorNode<"A_Expr"> = {
  node: "A_Expr",
  children: (node) => [
    ...(node.name ?? []),
    ...(node.lexpr ? [node.lexpr] : []),
    ...(node.rexpr ? [node.rexpr] : []),
  ],
};

const TYPE_CAST_VALIDATOR: ValidatorNode<"TypeCast"> = {
  node: "TypeCast",
  children: (node) => [
    ...(node.arg ? [node.arg] : []),
    ...(node.typeName ? [{ TypeName: node.typeName }] : []),
  ],
};

const COLLATE_CLAUSE_VALIDATOR: ValidatorNode<"CollateClause"> = {
  node: "CollateClause",
  children: (node) => [
    ...(node.arg ? [node.arg] : []),
    ...(node.collname ?? []),
  ],
};

const ALLOWED_FUNCTIONS = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "lower",
  "upper",
  "length",
  "trim",
  "replace",
  "substring",
  "cast",
  "concat",
  "now",
  "current_timestamp",
  "current_date",
  "current_time",
  "coalesce",
  "json_agg",
  "json_object",
  "json_array",
  "json_object_agg",
  "json_array_agg",
  "json_build_array",
]);

const FUNC_CALL_VALIDATOR: ValidatorNode<"FuncCall"> = {
  node: "FuncCall",
  children: (node) => [
    ...(node.funcname ?? []),
    ...(node.args ?? []),
    ...(node.agg_order ?? []),
    ...(node.agg_filter ? [node.agg_filter] : []),
    ...(node.over ? [{ WindowDef: node.over }] : []),
  ],
  validate: (node) => {
    if (
      node.funcname?.every(
        (name) =>
          getNodeType(name) === "String" &&
          // @ts-ignore
          ALLOWED_FUNCTIONS.has(name.String.sval),
      )
    ) {
      return;
    }
    throw new Error("Function call not supported");
  },
};

const A_STAR_VALIDATOR: ValidatorNode<"A_Star"> = {
  node: "A_Star",
  children: () => [],
};

const A_INDICES_VALIDATOR: ValidatorNode<"A_Indices"> = {
  node: "A_Indices",
  children: (node) => [
    ...(node.lidx ? [node.lidx] : []),
    ...(node.uidx ? [node.uidx] : []),
  ],
};

const A_INDIRECTION_VALIDATOR: ValidatorNode<"A_Indirection"> = {
  node: "A_Indirection",
  children: (node) => [
    ...(node.arg ? [node.arg] : []),
    ...(node.indirection ?? []),
  ],
};

const A_ARRAY_EXPR_VALIDATOR: ValidatorNode<"A_ArrayExpr"> = {
  node: "A_ArrayExpr",
  children: (node) => [...(node.elements ?? [])],
};

const RES_TARGET_VALIDATOR: ValidatorNode<"ResTarget"> = {
  node: "ResTarget",
  children: (node) => [
    ...(node.indirection ?? []),
    ...(node.val ? [node.val] : []),
  ],
};

const MULTI_ASSIGN_REF_VALIDATOR: ValidatorNode<"MultiAssignRef"> = {
  node: "MultiAssignRef",
  children: (node) => [...(node.source ? [node.source] : [])],
};

const SORT_BY_VALIDATOR: ValidatorNode<"SortBy"> = {
  node: "SortBy",
  children: (node) => [
    ...(node.node ? [node.node] : []),
    ...(node.useOp ?? []),
  ],
};

const RANGE_SUBSELECT_VALIDATOR: ValidatorNode<"RangeSubselect"> = {
  node: "RangeSubselect",
  children: (node) => [
    ...(node.subquery ? [node.subquery] : []),
    ...(node.alias ? [{ Alias: node.alias }] : []),
  ],
};

const SORT_GROUP_CLAUSE_VALIDATOR: ValidatorNode<"SortGroupClause"> = {
  node: "SortGroupClause",
  children: () => [],
};

const GROUPING_SET_VALIDATOR: ValidatorNode<"GroupingSet"> = {
  node: "GroupingSet",
  children: (node) => [...(node.content ?? [])],
};

const WITH_CLAUSE_VALIDATOR: ValidatorNode<"WithClause"> = {
  node: "WithClause",
  children: (node) => [...(node.ctes ?? [])],
  validate: (node) => {
    if (node.recursive) {
      throw new Error("Recursive CTEs not supported");
    }
  },
};

const COMMON_TABLE_EXPR_VALIDATOR: ValidatorNode<"CommonTableExpr"> = {
  node: "CommonTableExpr",
  children: (node) => [
    ...(node.aliascolnames ?? []),
    ...(node.ctequery ? [node.ctequery] : []),
    ...(node.search_clause ? [{ CTESearchClause: node.search_clause }] : []),
    ...(node.cycle_clause ? [{ CTECycleClause: node.cycle_clause }] : []),
    ...(node.ctecolnames ?? []),
    ...(node.ctecoltypes ?? []),
    ...(node.ctecoltypmods ?? []),
    ...(node.ctecolcollations ?? []),
  ],
  validate: (node) => {
    if (node.ctematerialized === "CTEMaterializeAlways" || node.cterecursive) {
      throw new Error("Invalid CTE");
    }
  },
};

const JSON_OUTPUT_VALIDATOR: ValidatorNode<"JsonOutput"> = {
  node: "JsonOutput",
  children: (node) => [
    ...(node.returning ? [{ JsonReturning: node.returning }] : []),
  ],
};

const JSON_KEY_VALUE_VALIDATOR: ValidatorNode<"JsonKeyValue"> = {
  node: "JsonKeyValue",
  children: (node) => [
    ...(node.key ? [node.key] : []),
    ...(node.value ? [{ JsonValueExpr: node.value }] : []),
  ],
};

const JSON_OBJECT_CONSTRUCTOR_VALIDATOR: ValidatorNode<"JsonObjectConstructor"> =
  {
    node: "JsonObjectConstructor",
    children: (node) => [
      ...(node.exprs ?? []),
      ...(node.output ? [{ JsonOutput: node.output }] : []),
    ],
  };

const JSON_ARRAY_CONSTRUCTOR_VALIDATOR: ValidatorNode<"JsonArrayConstructor"> =
  {
    node: "JsonArrayConstructor",
    children: (node) => [
      ...(node.exprs ?? []),
      ...(node.output ? [{ JsonOutput: node.output }] : []),
    ],
  };

const JSON_ARRAY_QUERY_CONSTRUCTOR_VALIDATOR: ValidatorNode<"JsonArrayQueryConstructor"> =
  {
    node: "JsonArrayQueryConstructor",
    children: (node) => [
      ...(node.query ? [node.query] : []),
      ...(node.output ? [{ JsonOutput: node.output }] : []),
      ...(node.format ? [{ JsonFormat: node.format }] : []),
    ],
  };

const JSON_AGG_CONSTRUCTOR_VALIDATOR: ValidatorNode<"JsonAggConstructor"> = {
  node: "JsonAggConstructor",
  children: (node) => [
    ...(node.output ? [{ JsonOutput: node.output }] : []),
    ...(node.agg_filter ? [node.agg_filter] : []),
    ...(node.agg_order ?? []),
    ...(node.over ? [{ WindowDef: node.over }] : []),
  ],
};

const JSON_OBJECT_AGG_VALIDATOR: ValidatorNode<"JsonObjectAgg"> = {
  node: "JsonObjectAgg",
  children: (node) => [
    ...(node.constructor ? [{ JsonAggConstructor: node.constructor }] : []),
    ...(node.arg ? [{ JsonKeyValue: node.arg }] : []),
  ],
};

const JSON_ARRAY_AGG_VALIDATOR: ValidatorNode<"JsonArrayAgg"> = {
  node: "JsonArrayAgg",
  children: (node) => [
    ...(node.constructor ? [{ JsonAggConstructor: node.constructor }] : []),
    ...(node.arg ? [{ JsonValueExpr: node.arg }] : []),
  ],
};

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

const COMMENT_STMT_VALIDATOR: ValidatorNode<"CommentStmt"> = {
  node: "CommentStmt",
  children: (node) => [...(node.object ? [node.object] : [])],
};

/** Validation rules for allowed Postgres SQL AST nodes. */
const ALLOW_LIST = new Map(
  [
    INTEGER_VALIDATOR,
    FLOAT_VALIDATOR,
    BOOLEAN_VALIDATOR,
    STRING_VALIDATOR,
    BIT_STRING_VALIDATOR,
    LIST_VALIDATOR,
    OID_LIST_VALIDATOR,
    INT_LIST_VALIDATOR,
    A_CONST_VALIDATOR,
    ALIAS_VALIDATOR,
    RANGE_VAR_VALIDATOR,
    VAR_VALIDATOR,
    PARAM_VALIDATOR,
    AGGREF_VALIDATOR,
    GROUPING_FUNC_VALIDATOR,
    WINDOW_FUNC_VALIDATOR,
    NAMED_ARG_EXPR_VALIDATOR,
    OP_EXPR_VALIDATOR,
    DISTINCT_EXPR_VALIDATOR,
    NULL_IF_EXPR_VALIDATOR,
    SCALAR_ARRAY_OP_EXPR_VALIDATOR,
    BOOL_EXPR_VALIDATOR,
    FIELD_SELECT_VALIDATOR,
    RELABEL_TYPE_VALIDATOR,
    ARRAY_COERCE_EXPR_VALIDATOR,
    CONVERT_ROWTYPE_EXPR_VALIDATOR,
    COLLATE_EXPR_VALIDATOR,
    CASE_EXPR_VALIDATOR,
    CASE_WHEN_VALIDATOR,
    CASE_TEST_EXPR_VALIDATOR,
    ARRAY_EXPR_VALIDATOR,
    ROW_EXPR_VALIDATOR,
    ROW_COMPARE_EXPR_VALIDATOR,
    COALESC_EXPR_VALIDATOR,
    MIN_MAX_EXPR_VALIDATOR,
    SQL_VALUE_FUNCTION_VALIDATOR,
    JSON_FORMAT_VALIDATOR,
    JSON_RETURNING_VALIDATOR,
    JSON_VALUE_EXPR_VALIDATOR,
    JSON_CONSTRUCTOR_EXPR_VALIDATOR,
    JSON_IS_PREDICATE_VALIDATOR,
    NULL_TEST_VALIDATOR,
    BOOLEAN_TEST_VALIDATOR,
    COERCE_TO_DOMAIN_VALIDATOR,
    COERCE_TO_DOMAIN_VALUE_VALIDATOR,
    CURRENT_OF_EXPR_VALIDATOR,
    NEXT_VALUE_EXPR_VALIDATOR,
    INFERENCE_ELEM_VALIDATOR,
    TARGET_ENTRY_VALIDATOR,
    RANGE_TBL_REF_VALIDATOR,
    JOIN_EXPR_VALIDATOR,
    FROM_EXPR_VALIDATOR,
    ON_CONFLICT_EXPR_VALIDATOR,
    TYPE_NAME_VALIDATOR,
    COLUMN_REF_VALIDATOR,
    PARAM_REF_VALIDATOR,
    A_EXPR_VALIDATOR,
    TYPE_CAST_VALIDATOR,
    COLLATE_CLAUSE_VALIDATOR,
    FUNC_CALL_VALIDATOR,
    A_STAR_VALIDATOR,
    A_INDICES_VALIDATOR,
    A_INDIRECTION_VALIDATOR,
    A_ARRAY_EXPR_VALIDATOR,
    RES_TARGET_VALIDATOR,
    MULTI_ASSIGN_REF_VALIDATOR,
    SORT_BY_VALIDATOR,
    RANGE_SUBSELECT_VALIDATOR,
    SORT_GROUP_CLAUSE_VALIDATOR,
    GROUPING_SET_VALIDATOR,
    WITH_CLAUSE_VALIDATOR,
    COMMON_TABLE_EXPR_VALIDATOR,
    JSON_OUTPUT_VALIDATOR,
    JSON_KEY_VALUE_VALIDATOR,
    JSON_OBJECT_CONSTRUCTOR_VALIDATOR,
    JSON_ARRAY_CONSTRUCTOR_VALIDATOR,
    JSON_ARRAY_QUERY_CONSTRUCTOR_VALIDATOR,
    JSON_AGG_CONSTRUCTOR_VALIDATOR,
    JSON_OBJECT_AGG_VALIDATOR,
    JSON_ARRAY_AGG_VALIDATOR,
    SELECT_STMT_VALIDATOR,
    COMMENT_STMT_VALIDATOR,
  ].map((node) => [node.node, node]),
);

// NOT_ALLOW_LIST
// ParseResult
// ScanResult
// TableFunc
// IntoClause
// SubscriptingRef
// FuncExpr
// SubLink
// SubPlan
// AlternativeSubPlan
// FieldStore
// CoerceViaIO
// XmlExpr
// SetToDefault
// Query
// RoleSpec
// WindowDef
// RangeFunction
// RangeTableFunc
// RangeTableFuncCol
// RangeTableSample
// ColumnDef
// TableLikeClause
// IndexElem
// DefElem
// LockingClause
// XmlSerialize
// PartitionElem
// PartitionSpec
// PartitionBounSpec
// PartitionRangeDatum
// PartitionCmd
// RangeTableEntry
// RTEPermissionInfo
// RangeTblFunction
// TableSampleClause
// WithCheckOption
// WindowClause
// RowMarkClause
// InferClausej
// OnConflictClause
// CTESearchClause
// CTECycleClause
// MergeWhenClause
// MergeAction
// TriggerTransition
// RawStmt
// InsertStmt
// DeleteStmt
// UpdateStmt
// MergeStmt
// SetOperationStmt
// ReturnStmt
// PLAssignStmt
// CreateSchemaStmt
// AlterTableStmt
// ReplicaIdentityStmt
// AlterTableCmd
// AlterCollationStmt
// AlterDomainStmt
// GrantStmt
// ObjectWithArgs
// AccessPriv
// GrantRoleStmt
// AlterDefaultPrivilegesStmt
// CopyStmt
// VariableSetStmt
// VariableShowStmt
// CreateStmt
// Constraint
// CreateTableSpaceStmt
// DropTableSpaceStmt
// AlterTableSpaceOptionsStmt
// AlterTableMoveAllStmt
// CreateExtensionStmt
// AlterExtensionStmt
// AlterExtensionContentsStmt
// CreateFdwStmt
// AlterFdwStmt
// CreateForeignServerStmt
// AlterForeignServerStmt
// CreateForeignTableStmt
// CreateUserMappingStmt
// AlterUserMappingStmt
// DropUserMappingStmt
// ImportForeignSchemaStmt
// CreatePolicyStmt
// AlterPolicyStmt
// CreateAmStmt
// CreateTrigStmt
// CreateEventTrigStmt
// AlterEventTrigStmt
// CreatePLangStmt
// CreateRoleStmt
// AlterRoleStmt
// AlterRoleSetStmt
// DropRoleStmt
// CreateSeqStmt
// AlterSeqStmt
// DefineStmt
// CreateDomainStmt
// CreateOpClassStmt
// CreateOpClassItem
// CreateOpFamilyStmt
// AlterOpFamilyStmt
// DropStmt
// TruncateStmt
// SecLabelStmt
// DeclareCursorStmt
// ClosePortalStmt
// FetchStmt
// IndexStmt
// CreateStatsStmt
// StatsElem
// AlterStatsStmt
// CreateFunctionStmt
// FunctionParameter
// AlterFunctionStmt
// DoStmt
// InlineCodeBlock
// CallStmt
// CallContext
// RenameStmt
// AlterObjectDependsStmt
// AlterObjectSchemaStmt
// AlterOwnerStmt
// AlterOperatorStmt
// AlterTypeStmt
// RuleStmt
// NotifyStmt
// ListenStmt
// UnlistenStmt
// TransactionStmt
// CompositeTypeStmt
// CreateEnumStmt
// CreateRangeStmt
// AlterEnumStmt
// ViewStmt
// LoadStmt
// CreatedbStmt
// AlterDatabaseStmt
// AlterDatabaseRefreshCollStmt
// AlterDatabaseSetStmt
// DropdbStmt
// AlterSystemStmt
// ClusterStmt
// VacuumStmt
// VacuumRelation
// ExplainStmt
// CreateTableAsStmt
// RefreshMatViewStmt
// CheckPointStmt
// DiscardStmt
// LockStmt
// ConstraintsSetStmt
// ReindexStmt
// CreateConversionStmt
// CreateCastStmt
// CreateTransformStmt
// PrepareStmt
// ExecuteStmt
// DeallocateStmt
// DropOwnedStmt
// ReassignOwnedStmt
// AlterTSDictionaryStmt
// AlterTSConfigurationStmt
// PublicationTable
// PublicationObjSpec
// CreatePublicationStmt
// AlterPublicationStmt
// CreateSubscriptionStmt
// AlterSubscriptionStmt
// DropSubscriptionStmt
// ScanToken

const SYSTEM_TABLES = new Set([
  "pg_statistic",
  "pg_type",
  "pg_foreign_table",
  "pg_proc_oid_index",
  "pg_proc_proname_args_nsp_index",
  "pg_type_oid_index",
  "pg_type_typname_nsp_index",
  "pg_attribute_relid_attnam_index",
  "pg_attribute_relid_attnum_index",
  "pg_class_oid_index",
  "pg_class_relname_nsp_index",
  "pg_class_tblspc_relfilenode_index",
  "pg_attrdef_adrelid_adnum_index",
  "pg_attrdef_oid_index",
  "pg_constraint_conname_nsp_index",
  "pg_constraint_conrelid_contypid_conname_index",
  "pg_constraint_contypid_index",
  "pg_constraint_oid_index",
  "pg_constraint_conparentid_index",
  "pg_inherits_relid_seqno_index",
  "pg_inherits_parent_index",
  "pg_index_indrelid_index",
  "pg_index_indexrelid_index",
  "pg_operator_oid_index",
  "pg_operator_oprname_l_r_n_index",
  "pg_opfamily_am_name_nsp_index",
  "pg_opfamily_oid_index",
  "pg_opclass_am_name_nsp_index",
  "pg_opclass_oid_index",
  "pg_am_name_index",
  "pg_am_oid_index",
  "pg_amop_fam_strat_index",
  "pg_amop_opr_fam_index",
  "pg_amop_oid_index",
  "pg_amproc_fam_proc_index",
  "pg_amproc_oid_index",
  "pg_language_name_index",
  "pg_language_oid_index",
  "pg_largeobject_metadata_oid_index",
  "pg_largeobject_loid_pn_index",
  "pg_aggregate_fnoid_index",
  "pg_statistic_relid_att_inh_index",
  "pg_statistic_ext_oid_index",
  "pg_statistic_ext_name_index",
  "pg_statistic_ext_relid_index",
  "pg_statistic_ext_data_stxoid_inh_index",
  "pg_rewrite_oid_index",
  "pg_rewrite_rel_rulename_index",
  "pg_trigger_tgconstraint_index",
  "pg_trigger_tgrelid_tgname_index",
  "pg_trigger_oid_index",
  "pg_event_trigger_evtname_index",
  "pg_event_trigger_oid_index",
  "pg_description_o_c_o_index",
  "pg_cast_oid_index",
  "pg_cast_source_target_index",
  "pg_enum_oid_index",
  "pg_enum_typid_label_index",
  "pg_enum_typid_sortorder_index",
  "pg_namespace_nspname_index",
  "pg_namespace_oid_index",
  "pg_conversion_default_index",
  "pg_conversion_name_nsp_index",
  "pg_conversion_oid_index",
  "pg_depend_depender_index",
  "pg_depend_reference_index",
  "pg_database_datname_index",
  "pg_database_oid_index",
  "pg_db_role_setting_databaseid_rol_index",
  "pg_tablespace_oid_index",
  "pg_tablespace_spcname_index",
  "pg_authid_rolname_index",
  "pg_authid_oid_index",
  "pg_auth_members_oid_index",
  "pg_auth_members_role_member_index",
  "pg_auth_members_member_role_index",
  "pg_auth_members_grantor_index",
  "pg_shdepend_depender_index",
  "pg_shdepend_reference_index",
  "pg_shdescription_o_c_index",
  "pg_ts_config_cfgname_index",
  "pg_ts_config_oid_index",
  "pg_ts_config_map_index",
  "pg_ts_dict_dictname_index",
  "pg_ts_dict_oid_index",
  "pg_ts_parser_prsname_index",
  "pg_ts_parser_oid_index",
  "pg_ts_template_tmplname_index",
  "pg_ts_template_oid_index",
  "pg_extension_oid_index",
  "pg_extension_name_index",
  "pg_foreign_data_wrapper_oid_index",
  "pg_foreign_data_wrapper_name_index",
  "pg_foreign_server_oid_index",
  "pg_foreign_server_name_index",
  "pg_user_mapping_oid_index",
  "pg_user_mapping_user_server_index",
  "pg_foreign_table_relid_index",
  "pg_policy_oid_index",
  "pg_policy_polrelid_polname_index",
  "pg_replication_origin_roiident_index",
  "pg_replication_origin_roname_index",
  "pg_default_acl_role_nsp_obj_index",
  "pg_default_acl_oid_index",
  "pg_init_privs_o_c_o_index",
  "pg_seclabel_object_index",
  "pg_shseclabel_object_index",
  "pg_collation_name_enc_nsp_index",
  "pg_collation_oid_index",
  "pg_parameter_acl_parname_index",
  "pg_parameter_acl_oid_index",
  "pg_partitioned_table_partrelid_index",
  "pg_range_rngtypid_index",
  "pg_range_rngmultitypid_index",
  "pg_transform_oid_index",
  "pg_transform_type_lang_index",
  "pg_sequence_seqrelid_index",
  "pg_publication_oid_index",
  "pg_publication_pubname_index",
  "pg_publication_namespace_oid_index",
  "pg_publication_namespace_pnnspid_pnpubid_index",
  "pg_publication_rel_oid_index",
  "pg_publication_rel_prrelid_prpubid_index",
  "pg_publication_rel_prpubid_index",
  "pg_subscription_oid_index",
  "pg_subscription_subname_index",
  "pg_subscription_rel_srrelid_srsubid_index",
  "pg_authid",
  "pg_shadow",
  "pg_roles",
  "pg_statistic_ext_data",
  "pg_hba_file_rules",
  "pg_settings",
  "pg_file_settings",
  "pg_backend_memory_contexts",
  "pg_ident_file_mappings",
  "pg_config",
  "pg_shmem_allocations",
  "pg_tables",
  "pg_user_mapping",
  "pg_replication_origin_status",
  "pg_subscription",
  "pg_attribute",
  "pg_proc",
  "pg_class",
  "pg_attrdef",
  "pg_constraint",
  "pg_inherits",
  "pg_index",
  "pg_operator",
  "pg_statio_all_sequences",
  "pg_opfamily",
  "pg_opclass",
  "pg_am",
  "pg_amop",
  "pg_amproc",
  "pg_language",
  "pg_largeobject_metadata",
  "pg_aggregate",
  "pg_statistic_ext",
  "pg_rewrite",
  "pg_trigger",
  "pg_event_trigger",
  "pg_description",
  "pg_cast",
  "pg_enum",
  "pg_namespace",
  "pg_conversion",
  "pg_depend",
  "pg_database",
  "pg_db_role_setting",
  "pg_tablespace",
  "pg_auth_members",
  "pg_shdepend",
  "pg_shdescription",
  "pg_ts_config",
  "pg_ts_config_map",
  "pg_ts_dict",
  "pg_ts_parser",
  "pg_ts_template",
  "pg_extension",
  "pg_foreign_data_wrapper",
  "pg_foreign_server",
  "pg_policy",
  "pg_replication_origin",
  "pg_default_acl",
  "pg_init_privs",
  "pg_seclabel",
  "pg_shseclabel",
  "pg_collation",
  "pg_parameter_acl",
  "pg_partitioned_table",
  "pg_range",
  "pg_transform",
  "pg_sequence",
  "pg_publication",
  "pg_publication_namespace",
  "pg_publication_rel",
  "pg_subscription_rel",
  "pg_group",
  "pg_user",
  "pg_policies",
  "pg_rules",
  "pg_views",
  "pg_matviews",
  "pg_indexes",
  "pg_sequences",
  "pg_stats",
  "pg_stats_ext",
  "pg_stats_ext_exprs",
  "pg_publication_tables",
  "pg_locks",
  "pg_cursors",
  "pg_available_extensions",
  "pg_available_extension_versions",
  "pg_prepared_xacts",
  "pg_prepared_statements",
  "pg_seclabels",
  "pg_timezone_abbrevs",
  "pg_timezone_names",
  "pg_stat_all_tables",
  "pg_stat_xact_all_tables",
  "pg_stat_xact_user_tables",
  "pg_stat_sys_tables",
  "pg_stat_xact_sys_tables",
  "pg_stat_user_tables",
  "pg_statio_all_tables",
  "pg_statio_sys_tables",
  "pg_statio_user_tables",
  "pg_stat_all_indexes",
  "pg_stat_sys_indexes",
  "pg_stat_user_indexes",
  "pg_statio_all_indexes",
  "pg_statio_sys_indexes",
  "pg_statio_user_indexes",
  "pg_statio_sys_sequences",
  "pg_statio_user_sequences",
  "pg_stat_activity",
  "pg_stat_replication",
  "pg_stat_slru",
  "pg_stat_wal_receiver",
  "pg_stat_recovery_prefetch",
  "pg_stat_subscription",
  "pg_stat_ssl",
  "pg_stat_gssapi",
  "pg_replication_slots",
  "pg_stat_replication_slots",
  "pg_stat_database",
  "pg_stat_database_conflicts",
  "pg_stat_user_functions",
  "pg_stat_xact_user_functions",
  "pg_stat_archiver",
  "pg_stat_bgwriter",
  "pg_stat_io",
  "pg_stat_wal",
  "pg_stat_progress_analyze",
  "pg_stat_progress_vacuum",
  "pg_stat_progress_cluster",
  "pg_stat_progress_create_index",
  "pg_stat_progress_basebackup",
  "pg_stat_progress_copy",
  "pg_user_mappings",
  "pg_stat_subscription_stats",
  "pg_largeobject",
]);
