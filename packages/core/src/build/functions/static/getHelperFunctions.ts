import type { SgNode } from "@ast-grep/napi";
import { ts } from "@ast-grep/napi";

export const getHelperFunctions = ({
  file,
}: { file: SgNode }): { functionName: string; body: SgNode }[] => {
  const arrowFunctions = file.findAll(ts.kind("arrow_function"));
  const functionDeclarations = file.findAll(ts.kind("function_declaration"));
  const methodDeclarations = file.findAll(ts.kind("method_declaration"));

  return {} as any;
};
