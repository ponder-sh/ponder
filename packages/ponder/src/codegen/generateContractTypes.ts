import path from "node:path";
import { runTypeChain } from "typechain";

import { OPTIONS } from "@/common/options";
import type { Source } from "@/sources/base";

export const generateContractTypes = async (sources: Source[]) => {
  const cwd = process.cwd();

  const abiFilePaths = sources.map((source) => source.abiFilePath);

  // TODO: don't parse all the ABI files again, use the Contract.Interface we already have?
  // TODO: don't generate factory files, we don't need them?
  await runTypeChain({
    cwd,
    filesToProcess: abiFilePaths,
    allFiles: abiFilePaths,
    outDir: path.join(OPTIONS.GENERATED_DIR_PATH, "typechain"),
    target: "ethers-v5",
  });
};
