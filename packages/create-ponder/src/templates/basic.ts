import { writeFileSync } from "node:fs";
import path from "node:path";

import type { SerializableConfig } from "@/index";

export const fromBasic = ({ rootDir }: { rootDir: string }) => {
  const abiFileContents = `[]`;

  const abiRelativePath = "./abis/ExampleContract.json";
  const abiAbsolutePath = path.join(rootDir, abiRelativePath);
  writeFileSync(abiAbsolutePath, abiFileContents);

  // Build the partial ponder config.
  const config: SerializableConfig = {
    networks: [
      {
        name: "mainnet",
        chainId: 1,
        transport: `http(process.env.PONDER_RPC_URL_1)`,
      },
    ],
    contracts: [
      {
        name: "ExampleContract",
        network: "mainnet",
        address: "0x0",
        abi: abiRelativePath,
        startBlock: 1234567,
      },
    ],
  };

  return config;
};
