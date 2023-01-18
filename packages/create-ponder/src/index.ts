import { ethers } from "ethers";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pico from "picocolors";
import prettier from "prettier";

import type { CreatePonderOptions } from "@/bin/create-ponder";
import { detect } from "@/helpers/detectPackageManager";
import { fromBasic } from "@/templates/basic";
import { fromEtherscan } from "@/templates/etherscan";
import { fromSubgraph } from "@/templates/subgraph";

export type PonderNetwork = {
  kind?: string;
  name: string;
  chainId: number;
  rpcUrl: string;
};

export type PonderSource = {
  kind?: "evm";
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

export const run = async (
  options: CreatePonderOptions,
  overrides: { installCommand?: string } = {}
) => {
  const { ponderRootDir } = options;

  // Create required directories.
  mkdirSync(path.join(ponderRootDir, "abis"), { recursive: true });
  mkdirSync(path.join(ponderRootDir, "src"), { recursive: true });

  let ponderConfig: PartialPonderConfig;
  if (options.fromSubgraph) {
    console.log(pico.cyan("[create-ponder] ") + `Bootstrapping from subgraph`);
    ponderConfig = fromSubgraph(options);
  } else if (options.fromEtherscan) {
    console.log(pico.cyan("[create-ponder] ") + `Bootstrapping from Etherscan`);
    ponderConfig = await fromEtherscan(options);
  } else {
    ponderConfig = fromBasic(options);
  }

  // Write the handler ts files.
  ponderConfig.sources.forEach((source) => {
    const abi = readFileSync(path.join(ponderRootDir, source.abi), {
      encoding: "utf-8",
    });
    const abiInterface = new ethers.utils.Interface(abi);
    const eventNames = Object.keys(abiInterface.events);

    const eventNamesToWrite = eventNames.slice(3);

    const handlerFileContents = `
      import { ponder } from '../generated'

      ${eventNamesToWrite
        .map(
          (eventName) => `
          ponder.on("${source.name}:${eventName}", async ({ event, context }) => {
            console.log(event.params)
          })`
        )
        .join("\n")}
    `;

    writeFileSync(
      path.join(ponderRootDir, `./src/${source.name}.ts`),
      prettier.format(handlerFileContents, { parser: "typescript" })
    );
  });

  // Write the ponder.ts file.
  const finalPonderConfig = `
    import type { PonderConfig } from "@ponder/core";
    import { graphqlPlugin } from "@ponder/graphql";

    export const config: PonderConfig = {
      plugins: [graphqlPlugin()],
      networks: ${JSON.stringify(ponderConfig.networks).replaceAll(
        /"process.env.PONDER_RPC_URL_(.*?)"/g,
        "process.env.PONDER_RPC_URL_$1"
      )},
      sources: ${JSON.stringify(ponderConfig.sources)},
    };
  `;

  writeFileSync(
    path.join(ponderRootDir, "ponder.ts"),
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
      "private": true,
      "scripts": {
        "dev": "ponder dev",
        "start": "ponder start",
        "codegen": "ponder codegen"
      },
      "dependencies": {
        "@ponder/core": "latest",
        "@ponder/graphql": "latest"
      },
      "devDependencies": {
        "@types/node": "^18.11.18",
        "ethers": "^5.6.9"
      },
      "engines": {
        "node": ">=16.0.0 <19.0.0"
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
    `node_modules/\n.DS_Store\n\n.env.local\n.ponder/\ngenerated/`
  );

  const packageManager = await detect();
  const runCommand =
    packageManager === "npm" ? `${packageManager} run` : packageManager;

  // Install packages.
  console.log(
    pico.cyan("[create-ponder] ") + `Installing with ${packageManager}`
  );

  const installCommand = overrides.installCommand
    ? overrides.installCommand
    : `${packageManager} install`;

  execSync(installCommand, {
    cwd: ponderRootDir,
    stdio: "inherit",
  });

  // Run codegen.
  console.log(pico.cyan("[create-ponder] ") + `Generating types`);

  execSync(`${runCommand} --silent codegen --silent`, {
    cwd: ponderRootDir,
    stdio: "inherit",
  });

  console.log(
    pico.cyan("[create-ponder] ") +
      pico.green("Done! ") +
      `To get started run ${pico.yellow(`${runCommand} dev`)}`
  );
};
