import type { FieldNode, GraphQLResolveInfo, SelectionNode } from "graphql";

export function hasSubfield(
  info: GraphQLResolveInfo,
  pathArray: string[],
): boolean {
  return info.fieldNodes.some((fieldNode) =>
    findSubfieldRecursive(fieldNode, pathArray),
  );
}

function findSubfieldRecursive(node: FieldNode, pathArray: string[]): boolean {
  if (pathArray.length === 0) {
    return true;
  }

  if (!node.selectionSet) {
    return false;
  }

  const [currentField, ...remainingPath] = pathArray;

  return node.selectionSet.selections.some((selection: SelectionNode) => {
    if (selection.kind !== "Field") {
      return false;
    }
    const fieldName = selection.name.value;
    return (
      fieldName === currentField &&
      findSubfieldRecursive(selection as FieldNode, remainingPath)
    );
  });
}
