import type { SgNode } from "@ast-grep/napi";

/**
 * Returns the indexing function key and callback node for all the Ponder indexing functions in a given file.
 */
export const getIndexingFunctions = ({
  file,
}: { file: SgNode }): {
  indexingFunctionKey: string;
  callbackNode: SgNode;
}[] => {
  const nodes = file
    .findAll('ponder.on("$NAME", $FUNC)')
    .concat(file.findAll("ponder.on('$NAME', $FUNC)"))
    .concat(file.findAll("ponder.on(`$NAME`, $FUNC)"));

  // Note: Could try to find the first string rather than matching on different quotation types
  // Note: Possible to verify matched indexing function key against registered keys

  return nodes.map((node) => {
    const indexingFunctionKey = node.getMatch("NAME")!.text();
    const callbackNode = node.getMatch("FUNC")!;

    return { indexingFunctionKey, callbackNode };
  });
};
