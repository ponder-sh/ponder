import type { Abi, AbiEvent } from "abitype";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pico from "picocolors";
import prettier from "prettier";
import { type Transport } from "viem";

import { CreatePonderOptions, TemplateKind } from "@/common";
import { getPackageManager } from "@/helpers/getPackageManager";
import { tryGitInit } from "@/helpers/git";
import { fromBasic } from "@/templates/basic";
import { fromEtherscan } from "@/templates/etherscan";
import { fromSubgraphId } from "@/templates/subgraphId";
import { fromSubgraphRepo } from "@/templates/subgraphRepo";

// NOTE: This is a workaround for tsconfig `rootDir` nonsense.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rootPackageJson from "../package.json";

export type Network = {
  name: string;
  chainId: number;
  transport: Transport;
};

export type Contract = {
  name: string;
  network: string;
  abi: string;
  address: string;
  startBlock?: number;
};

export type PartialConfig = {
  database?: {
    kind: string;
  };
  networks: Network[];
  contracts: Contract[];
};

export const run = async (
  options: CreatePonderOptions,
  overrides: { installCommand?: string } = {}
) => {
  const ponderVersion = rootPackageJson.version;
  const { rootDir } = options;

  // Create required directories.
  mkdirSync(path.join(rootDir, "abis"), { recursive: true });
  mkdirSync(path.join(rootDir, "src"), { recursive: true });

  let config: PartialConfig;

  console.log(
    `\nCreating a new Ponder app in ${pico.bold(pico.green(rootDir))}.`
  );

  switch (options.template?.kind) {
    case TemplateKind.ETHERSCAN: {
      console.log(`\nUsing ${pico.cyan("Etherscan contract link")} template.`);
      config = await fromEtherscan({
        rootDir,
        etherscanLink: options.template.link,
        etherscanApiKey: options.etherscanApiKey,
      });
      break;
    }
    case TemplateKind.SUBGRAPH_ID: {
      console.log(`\nUsing ${pico.cyan("Subgraph ID")} template.`);
      config = await fromSubgraphId({
        rootDir,
        subgraphId: options.template.id,
      });
      break;
    }
    case TemplateKind.SUBGRAPH_REPO: {
      console.log(`\nUsing ${pico.cyan("Subgraph repository")} template.`);

      config = fromSubgraphRepo({
        rootDir,
        subgraphPath: options.template.path,
      });
      break;
    }
    default: {
      config = fromBasic({ rootDir });
      break;
    }
  }

  // Write the handler ts files.
  config.contracts.forEach((contract) => {
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
  const finalConfig = `
    import type { Config } from "@ponder/core";

    export const config: Config = {
      networks: ${JSON.stringify(config.networks).replaceAll(
        /"process.env.PONDER_RPC_URL_(.*?)"/g,
        "process.env.PONDER_RPC_URL_$1"
      )},
      contracts: ${JSON.stringify(config.contracts)},
    };
  `;

  writeFileSync(
    path.join(rootDir, "ponder.config.ts"),
    prettier.format(finalConfig, { parser: "babel" })
  );

  // Write the .env.local file.
  const uniqueChainIds = Array.from(
    new Set(config.networks.map((n) => n.chainId))
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
        ${options.eslint ? `"lint": "eslint .",` : ""}
        "codegen": "ponder codegen"
      },
      "dependencies": {
        "@ponder/core": "${ponderVersion}",
      },
      "devDependencies": {
        ${options.eslint ? `"eslint-config-ponder": "${ponderVersion}",` : ""}
        ${options.eslint ? `"eslint": "^8.43.0",` : ""}
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

  if (options.eslint) {
    const eslintConfig = `
    {
      "extends": "ponder"
    }
  `;

    writeFileSync(
      path.join(rootDir, ".eslintrc.json"),
      prettier.format(eslintConfig, { parser: "json" })
    );
  }

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
