import fs from "node:fs";
import path from "node:path";
import { SgNode, js, ts } from "@ast-grep/napi";

export const parseFiles = ({
  filePaths,
}: { filePaths: string[] }): SgNode[] => {
  return filePaths.map((filePath) => parseFile({ filePath }));
};

export const parseFile = ({ filePath }: { filePath: string }) => {
  const extension = path.extname(filePath);
  const isJs =
    extension === ".js" || extension === ".mjs" || extension === ".cjs";

  const file = fs.readFileSync(filePath).toString();

  const ast = isJs ? js.parse(file) : ts.parse(file);
  return ast.root();
};
