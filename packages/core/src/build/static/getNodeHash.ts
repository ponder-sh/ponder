import crypto from "crypto";
import type { SgNode } from "@ast-grep/napi";

export const getNodeHash = (node: SgNode) => {
  const nodes: string[] = [];

  const dfs = (node: SgNode) => {
    nodes.push(node.text());
    for (const child of node.children()) {
      dfs(child);
    }
  };

  dfs(node);

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(nodes))
    .digest("hex");

  return hash;
};
