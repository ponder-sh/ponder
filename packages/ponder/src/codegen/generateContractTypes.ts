import path from "node:path";
import { runTypeChain } from "typechain";

import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";
import { Source } from "@/sources/base";

const generateContractTypes = async (sources: Source[]) => {
  const cwd = process.cwd();

  const abiFilePaths = sources.map((source) => source.abiFilePath);

  // TODO: don't parse all the ABI files again, use the Contract.Interface we already have?
  // TODO: don't generate factory files, we don't need them?
  await runTypeChain({
    cwd,
    filesToProcess: abiFilePaths,
    allFiles: abiFilePaths,
    outDir: path.join(CONFIG.GENERATED_DIR_PATH, "typechain"),
    target: "ethers-v5",
  });

  logger.info(`\x1b[36m${"GENERATED CONTRACT TYPES"}\x1b[0m`); // magenta
};

export { generateContractTypes };
