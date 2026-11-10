import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  GraphQLObjectType,
  type GraphQLSchema,
  getNamedType,
  getOperationAST,
  Kind,
  type SelectionSetNode,
} from "graphql";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./index.js";

/**
 * Returns the maximum number of rows that an operation can select.
 *
 * Every plural field (a `...Page` type) selects up to `limit` rows for each
 * row of its parent, so the rows of nested plural fields multiply. Every
 * singular field or `one` relation selects up to one row for each row of its
 * parent, and `totalCount` counts as one row.
 *
 * Note: Each row of a parent also runs one statement for each nested plural
 * field, so this also bounds the number of statements.
 */
export const getOperationRows = ({
  schema,
  document,
  operationName,
  variableValues,
}: {
  schema: GraphQLSchema;
  document: DocumentNode;
  operationName?: string | null;
  variableValues?: Record<string, unknown> | null;
}): number => {
  const operation = getOperationAST(document, operationName);
  const queryType = schema.getQueryType();
  if (!operation || !queryType) return 0;

  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments[definition.name.value] = definition;
    }
  }

  /** Returns the fields of `selectionSet`, including those of fragments. */
  const getFields = (selectionSet: SelectionSetNode | undefined) => {
    const fields: FieldNode[] = [];
    const visit = (selectionSet: SelectionSetNode | undefined) => {
      for (const selection of selectionSet?.selections ?? []) {
        if (selection.kind === Kind.FIELD) {
          fields.push(selection);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          visit(selection.selectionSet);
        } else {
          visit(fragments[selection.name.value]?.selectionSet);
        }
      }
    };
    visit(selectionSet);
    return fields;
  };

  const getLimit = (field: FieldNode) => {
    const argument = field.arguments?.find(
      (argument) => argument.name.value === "limit",
    );
    let limit: unknown = DEFAULT_LIMIT;
    if (argument?.value.kind === Kind.INT) {
      limit = Number(argument.value.value);
    } else if (argument?.value.kind === Kind.VARIABLE) {
      limit = variableValues?.[argument.value.name.value] ?? DEFAULT_LIMIT;
    }
    // Note: Invalid limits fail in the resolver.
    if (typeof limit !== "number" || Number.isNaN(limit)) return DEFAULT_LIMIT;
    return Math.min(Math.max(limit, 0), MAX_LIMIT);
  };

  /** Returns the rows selected by `selectionSet` for `parentRows` parents. */
  const getRows = (
    selectionSet: SelectionSetNode | undefined,
    parentType: GraphQLObjectType,
    parentRows: number,
  ): number => {
    let rows = 0;
    for (const field of getFields(selectionSet)) {
      const fieldDefinition = parentType.getFields()[field.name.value];
      if (fieldDefinition === undefined) continue;
      const type = getNamedType(fieldDefinition.type);
      if (type instanceof GraphQLObjectType === false) continue;

      const pageFields = type.getFields();
      if (pageFields.items !== undefined && pageFields.pageInfo !== undefined) {
        const itemRows = parentRows * getLimit(field);
        rows += itemRows;
        for (const pageField of getFields(field.selectionSet)) {
          if (pageField.name.value === "items") {
            rows += getRows(
              pageField.selectionSet,
              getNamedType(pageFields.items.type) as GraphQLObjectType,
              itemRows,
            );
          } else if (pageField.name.value === "totalCount") {
            rows += parentRows;
          }
        }
      } else {
        rows += parentRows;
        rows += getRows(field.selectionSet, type, parentRows);
      }
    }
    return rows;
  };

  return getRows(operation.selectionSet, queryType, 1);
};
