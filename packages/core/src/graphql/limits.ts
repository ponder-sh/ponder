import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  GraphQLError,
  GraphQLObjectType,
  type GraphQLSchema,
  getNamedType,
  getOperationAST,
  Kind,
  parse,
  type SelectionSetNode,
  type ValidationRule,
} from "graphql";
import type { Plugin } from "graphql-yoga";
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

/**
 * Returns the depth of the deepest field in an operation, where fragments
 * count at the depth where they are spread.
 */
const getDepth = (
  selectionSet: SelectionSetNode | undefined,
  fragments: Record<string, FragmentDefinitionNode>,
  visited: string[] = [],
): number => {
  let depth = 0;
  for (const selection of selectionSet?.selections ?? []) {
    if (selection.kind === Kind.FIELD) {
      depth = Math.max(
        depth,
        1 + getDepth(selection.selectionSet, fragments, visited),
      );
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      depth = Math.max(
        depth,
        getDepth(selection.selectionSet, fragments, visited),
      );
    } else {
      const name = selection.name.value;
      // Note: Fragment cycles fail validation with `NoFragmentCyclesRule`.
      if (visited.includes(name)) continue;
      depth = Math.max(
        depth,
        getDepth(fragments[name]?.selectionSet, fragments, [...visited, name]),
      );
    }
  }
  return depth;
};

/** Returns the number of aliases in an operation, counting each fragment spread. */
const getAliases = (
  selectionSet: SelectionSetNode | undefined,
  fragments: Record<string, FragmentDefinitionNode>,
  visited: string[] = [],
): number => {
  let aliases = 0;
  for (const selection of selectionSet?.selections ?? []) {
    if (selection.kind === Kind.FIELD) {
      if (selection.alias !== undefined) aliases++;
      aliases += getAliases(selection.selectionSet, fragments, visited);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      aliases += getAliases(selection.selectionSet, fragments, visited);
    } else {
      const name = selection.name.value;
      if (visited.includes(name)) continue;
      aliases += getAliases(fragments[name]?.selectionSet, fragments, [
        ...visited,
        name,
      ]);
    }
  }
  return aliases;
};

/** Validation rule that limits the depth and aliases of every operation. */
const operationLimitsRule =
  ({
    maxDepth,
    maxAliases,
  }: {
    maxDepth: number;
    maxAliases: number;
  }): ValidationRule =>
  (context) => {
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments[definition.name.value] = definition;
      }
    }

    return {
      OperationDefinition: (operation) => {
        const depth = getDepth(operation.selectionSet, fragments);
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Operation has a depth of ${depth}, which is more than the maximum of ${maxDepth}.`,
              { nodes: operation },
            ),
          );
        }
        const aliases = getAliases(operation.selectionSet, fragments);
        if (aliases > maxAliases) {
          context.reportError(
            new GraphQLError(
              `Operation has ${aliases} aliases, which is more than the maximum of ${maxAliases}.`,
              { nodes: operation },
            ),
          );
        }
      },
    };
  };

/**
 * graphql-yoga plugin that rejects operations with more than `maxTokens`
 * tokens, a depth of more than `maxDepth`, more than `maxAliases` aliases, or
 * that can select more than `maxRows` rows (see `getOperationRows`).
 *
 * Note: The rows are checked before execution instead of during validation
 * so that `limit` arguments from variables count.
 */
export const operationLimitsPlugin = ({
  maxTokens,
  maxDepth,
  maxAliases,
  maxRows,
}: {
  maxTokens: number;
  maxDepth: number;
  maxAliases: number;
  maxRows: number;
}): Plugin => ({
  onParse: ({ setParseFn }) => {
    setParseFn((source, options) => parse(source, { ...options, maxTokens }));
  },
  onValidate: ({ addValidationRule }) => {
    addValidationRule(operationLimitsRule({ maxDepth, maxAliases }));
  },
  onExecute: ({ args, setResultAndStopExecution }) => {
    const rows = getOperationRows(args);
    if (rows > maxRows) {
      setResultAndStopExecution({
        errors: [
          new GraphQLError(
            `Operation can select up to ${rows} rows, which is more than the maximum of ${maxRows}. Use smaller limit arguments for nested fields.`,
          ),
        ],
      });
    }
  },
});
