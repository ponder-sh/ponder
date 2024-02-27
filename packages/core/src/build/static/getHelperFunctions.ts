import type { SgNode } from "@ast-grep/napi";
import { ts } from "@ast-grep/napi";

export const getHelperFunctions = ({
  file,
}: { file: SgNode }): { functionName: string; bodyNode: SgNode }[] => {
  const helperFunctions: { functionName: string; bodyNode: SgNode }[] = [];

  const arrowFunctions = file.findAll(ts.kind("arrow_function"));
  const functionDeclarations = file.findAll(ts.kind("function_declaration"));
  const methodDeclarations = file.findAll(ts.kind("method_definition"));

  for (const node of arrowFunctions) {
    const functionName = node
      .prevAll()
      .find((a) => a.kind() === "identifier")
      ?.text();

    if (functionName !== undefined) {
      helperFunctions.push({
        functionName,
        bodyNode: node,
      });
    }

    const parameterName = node
      .prevAll()
      .find((a) => a.kind() === "property_identifier")
      ?.text();

    if (parameterName !== undefined) {
      helperFunctions.push({
        functionName: parameterName,
        bodyNode: node,
      });
    }
  }

  for (const node of functionDeclarations) {
    const functionName = node
      .children()
      .find((c) => c.kind() === "identifier")
      ?.text();

    if (functionName !== undefined) {
      helperFunctions.push({
        functionName,
        bodyNode: node,
      });
    }
  }

  for (const node of methodDeclarations) {
    const functionName = node
      .children()
      .find((c) => c.kind() === "property_identifier")
      ?.text();

    if (functionName !== undefined) {
      helperFunctions.push({
        functionName,
        bodyNode: node,
      });
    }
  }

  return helperFunctions;
};
