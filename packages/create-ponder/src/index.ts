import type { Abi, AbiEvent } from "abitype";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pico from "picocolors";
import prettier from "prettier";

import { CreatePonderOptions, TemplateKind } from "@/common";
import { getPackageManager } from "@/helpers/getPackageManager";
import { tryGitInit } from "@/helpers/git";
import { fromBasic } from "@/templates/basic";
import { fromEtherscan } from "@/templates/etherscan";
import { fromSubgraphId } from "@/templates/subgraphId";
import { fromSubgraphRepo } from "@/templates/subgraphRepo";

export type PonderNetwork = {
  name: string;
  chainId: number;
  rpcUrl: string;
};

export type PonderContract = {
  name: string;
  network: string;
  abi: string;
  address: string;
  startBlock?: number;
};

export type PartialPonderConfig = {
  database?: {
    kind: string;
  };
  networks: PonderNetwork[];
  contracts: PonderContract[];
};

export const run = async (
  options: CreatePonderOptions,
  overrides: { installCommand?: string } = {}
) => {
  const { rootDir } = options;

  // Create required directories.
  mkdirSync(path.join(rootDir, "abis"), { recursive: true });
  mkdirSync(path.join(rootDir, "src"), { recursive: true });

  let ponderConfig: PartialPonderConfig;

  console.log(
    `\nCreating a new Ponder app in ${pico.bold(pico.green(rootDir))}.`
  );

  switch (options.template?.kind) {
    case TemplateKind.ETHERSCAN: {
      console.log(`\nUsing ${pico.cyan("Etherscan contract link")} template.`);
      ponderConfig = await fromEtherscan({
        rootDir,
        etherscanLink: options.template.link,
        etherscanApiKey: options.etherscanApiKey,
      });
      break;
    }
    case TemplateKind.SUBGRAPH_ID: {
      console.log(`\nUsing ${pico.cyan("Subgraph ID")} template.`);
      ponderConfig = await fromSubgraphId({
        rootDir,
        subgraphId: options.template.id,
      });
      break;
    }
    case TemplateKind.SUBGRAPH_REPO: {
      console.log(`\nUsing ${pico.cyan("Subgraph repository")} template.`);

      ponderConfig = fromSubgraphRepo({
        rootDir,
        subgraphPath: options.template.path,
      });
      break;
    }
    default: {
      ponderConfig = fromBasic({ rootDir });
      break;
    }
  }

  // Write the handler ts files.
  ponderConfig.contracts.forEach((contract) => {
    let abi: Abi;
    if (Array.isArray(contract.abi)) {
      // If it's an array of ABIs, use the 2nd one (the implementation ABI).
      const abiString = readFileSync(path.join(rootDir, contract.abi[1]), {
        encoding: "utf-8",
      });
      abi = JSON.parse(abiString);
    } else {
      const abiString = readFileSync(path.join(rootDir, contract.abi), {
        encoding: "utf-8",
      });
      abi = JSON.parse(abiString);
    }

    const abiEvents = abi.filter(
      (item): item is AbiEvent => item.type === "event"
    );

    const eventNamesToWrite = abiEvents.map((event) => event.name).slice(0, 2);

    const handlerFileContents = `
      import { ponder } from '@/generated'

      ${eventNamesToWrite
        .map(
          (eventName) => `
          ponder.on("${contract.name}:${eventName}", async ({ event, context }) => {
            console.log(event.params)
          })`
        )
        .join("\n")}
    `;

    writeFileSync(
      path.join(rootDir, `./src/${contract.name}.ts`),
      prettier.format(handlerFileContents, { parser: "typescript" })
    );
  });

  // Write the ponder.config.ts file.
  const finalPonderConfig = `
    import type { PonderConfig } from "@ponder/core";

    export const config: PonderConfig = {
      networks: ${JSON.stringify(ponderConfig.networks).replaceAll(
        /"process.env.PONDER_RPC_URL_(.*?)"/g,
        "process.env.PONDER_RPC_URL_$1"
      )},
      contracts: ${JSON.stringify(ponderConfig.contracts)},
    };
  `;

  writeFileSync(
    path.join(rootDir, "ponder.config.ts"),
    prettier.format(finalPonderConfig, { parser: "babel" })
  );

  // Write the .env.local file.
  const uniqueChainIds = Array.from(
    new Set(ponderConfig.networks.map((n) => n.chainId))
  );
  const envLocal = `${uniqueChainIds.map(
    (chainId) => `PONDER_RPC_URL_${chainId}=""\n`
  )}`;
  writeFileSync(path.join(rootDir, ".env.local"), envLocal);

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
        "@ponder/core": "latest"
      },
      "devDependencies": {
        "@types/node": "^18.11.18",
        "abitype": "^0.8.11",
        "typescript": "^5.1.3",
        "viem": "^1.2.6"
      }
    }
  `;
  writeFileSync(
    path.join(rootDir, "package.json"),
    prettier.format(packageJson, { parser: "json" })
  );

  // Write the tsconfig.json file.
  const tsConfig = `
    {
      "compilerOptions": {
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "node",
        "resolveJsonModule": true,
        "esModuleInterop": true,
        "strict": true,
        "rootDir": ".",
        "paths": {
          "@/generated": ["./generated/index.ts"]
        }
      },
      "include": ["./**/*.ts"],
      "exclude": ["node_modules"]
    }
  `;
  writeFileSync(
    path.join(rootDir, "tsconfig.json"),
    prettier.format(tsConfig, { parser: "json" })
  );

  // Write the .gitignore file.
  writeFileSync(
    path.join(rootDir, ".gitignore"),
    `node_modules/\n.DS_Store\n\n.env.local\n.ponder/\ngenerated/`
  );

  const packageManager = await getPackageManager();

  // Install packages.
  console.log(pico.bold(`\nInstalling with ${packageManager}.`));

  const installCommand = overrides.installCommand
    ? overrides.installCommand
    : `${packageManager} ${
        packageManager === "npm" ? "--quiet" : "--silent"
      } install`;

  execSync(installCommand, {
    cwd: rootDir,
    stdio: "inherit",
  });

  // Intialize git repository
  process.chdir(rootDir);
  tryGitInit(rootDir);
  console.log(`\nInitialized a git repository.`);

  // Run codegen.
  const runCommand = `${
    packageManager === "npm" ? `npm --quiet run` : `${packageManager} --silent`
  } codegen`;
  execSync(runCommand, {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log(`\nGenerated types.`);

  console.log(
    pico.green("\nSuccess! ") + `Created ${options.projectName} at ${rootDir}`
  );
};
