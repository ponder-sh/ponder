import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";

import type { CreatePonderAppOptions } from "./bin/create-ponder-app";
import { fromBasic } from "./fromBasic";
import { fromEtherscan } from "./fromEtherscan";
import { fromSubgraph } from "./fromSubgraph";

export type PonderNetwork = {
  kind: string;
  name: string;
  chainId: number;
  rpcUrl: string;
};

export type PonderSource = {
  kind: "evm";
  name: string;
  network: string;
  abi: string;
  address: string;
  startBlock?: number;
};

export type PartialPonderConfig = {
  plugins: string[];
  database: {
    kind: string;
  };
  networks: PonderNetwork[];
  sources: PonderSource[];
};

export const run = (options: CreatePonderAppOptions) => {
  const { ponderRootDir } = options;

  // Create required directories.
  mkdirSync(path.join(ponderRootDir, "abis"), { recursive: true });
  mkdirSync(path.join(ponderRootDir, "handlers"), { recursive: true });

  let ponderConfig: PartialPonderConfig;
  if (options.fromSubgraph) {
    ponderConfig = fromSubgraph(options);
  } else if (options.fromEtherscan) {
    ponderConfig = fromEtherscan(options);
  } else {
    ponderConfig = fromBasic(options);
  }

  const finalPonderConfig = `const { graphqlPlugin } = require("@ponder/graphql");

/**
 * @type {import('@ponder/ponder').PonderConfig}
 */
const ponderConfig = {
  plugins: [graphqlPlugin()],
  database: {
    kind: "sqlite",
  },
  networks: ${JSON.stringify(ponderConfig.networks).replaceAll(
    /"process.env.PONDER_RPC_URL_(.*?)"/g,
    "process.env.PONDER_RPC_URL_$1"
  )},
  sources: ${JSON.stringify(ponderConfig.sources)},
};

module.exports = ponderConfig;`;

  writeFileSync(
    path.join(ponderRootDir, "ponder.config.js"),
    prettier.format(finalPonderConfig, { parser: "babel" })
  );

  // Write the .env.local file.
  const uniqueChainIds = Array.from(
    new Set(ponderConfig.networks.map((n) => n.chainId))
  );
  const envLocal = `${uniqueChainIds.map(
    (chainId) => `PONDER_RPC_URL_${chainId}=""\n`
  )}`;
  writeFileSync(path.join(ponderRootDir, ".env.local"), envLocal);

  // Write the package.json file.
  const packageJson = `
    {
      "version": "0.1.0",
      "private": true,
      "scripts": {
        "dev": "ponder dev",
        "start": "ponder start",
      },
      "dependencies": {
        "@ponder/ponder": "latest",
        "@ponder/graphql": "latest"
      },
      "devDependencies": {
        "ethers": "^5.6.9"
      },
      "engines": {
        "node": "16",
        "pnpm": "7"
      }
    }
  `;
  writeFileSync(
    path.join(ponderRootDir, "package.json"),
    prettier.format(packageJson, { parser: "json" })
  );

  // Write the tsconfig.json file.
  const tsConfig = `
    {
      "compilerOptions": {
        "target": "esnext",
        "module": "esnext",
        "esModuleInterop": true,
        "strict": true,
        "moduleResolution": "node"
      },
      "include": ["./**/*.ts"],
      "exclude": ["node_modules"]
    }
  `;
  writeFileSync(
    path.join(ponderRootDir, "tsconfig.json"),
    prettier.format(tsConfig, { parser: "json" })
  );

  // Write the .gitignore file.
  writeFileSync(
    path.join(ponderRootDir, ".gitignore"),
    `.env.local\n.ponder/\ngenerated/`
  );

  // TODO: Add more/better instructions here.
  console.log(
    `Go to ${ponderRootDir}, npm/yarn/pnpm install, and pnpm run dev to start the development server.`
  );
};
