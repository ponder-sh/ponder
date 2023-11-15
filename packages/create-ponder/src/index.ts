import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Abi, AbiEvent } from "abitype";
import pico from "picocolors";
import prettier from "prettier";

import type { CreatePonderOptions } from "@/common.js";
import { TemplateKind } from "@/common.js";
import { getPackageManager } from "@/helpers/getPackageManager.js";
import { tryGitInit } from "@/helpers/git.js";
import { fromBasic } from "@/templates/basic.js";
import { fromEtherscan } from "@/templates/etherscan.js";
import { fromSubgraphId } from "@/templates/subgraphId.js";

// NOTE: This is a workaround for tsconfig `rootDir` nonsense.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rootPackageJson from "../package.json";

export type SerializableNetwork = {
  name: string;
  chainId: number;
  transport: string;
};

export type SerializableContract = {
  name: string;
  network: string;
  abi: string;
  address: string;
  startBlock?: number;
};

export type SerializableConfig = {
  database?: { kind: string };
  networks: SerializableNetwork[];
  contracts: SerializableContract[];
};

export const run = async (
  options: CreatePonderOptions,
  overrides: { installCommand?: string } = {},
) => {
  const ponderVersion = rootPackageJson.version;
  const { rootDir } = options;

  // Create required directories.
  mkdirSync(path.join(rootDir, "abis"), { recursive: true });
  mkdirSync(path.join(rootDir, "src"), { recursive: true });

  let config: SerializableConfig;

  console.log(
    `\nCreating a new Ponder app in ${pico.bold(pico.green(rootDir))}.`,
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
    default: {
      config = fromBasic({ rootDir });
      break;
    }
  }

  // Write the indexing function files.
  config.contracts.forEach(async (contract) => {
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
      (item): item is AbiEvent => item.type === "event",
    );

    const eventNamesToWrite = abiEvents.map((event) => event.name).slice(0, 2);

    const indexingFunctionFileContents = `
      import { ponder } from '@/generated'

      ${eventNamesToWrite
        .map(
          (eventName) => `
          ponder.on("${contract.name}:${eventName}", async ({ event, context }) => {
            console.log(event.params)
          })`,
        )
        .join("\n")}
    `;

    writeFileSync(
      path.join(rootDir, `./src/${contract.name}.ts`),
      await prettier.format(indexingFunctionFileContents, {
        parser: "typescript",
      }),
    );
  });

  // Write the ponder.config.ts file.
  const finalConfig = `
    import type { Config } from "@ponder/core";
    import { http } from "viem";

    export const config: Config = {
      networks: ${JSON.stringify(config.networks)
        .replaceAll(
          /"process.env.PONDER_RPC_URL_(.*?)"/g,
          "process.env.PONDER_RPC_URL_$1",
        )
        .replaceAll(/"http\((.*?)\)"/g, "http($1)")},
      contracts: ${JSON.stringify(config.contracts)},
    };
  `;

  writeFileSync(
    path.join(rootDir, "ponder.config.ts"),
    await prettier.format(finalConfig, { parser: "babel" }),
  );

  // Write the ponder.schema.ts file
  const schemaGraphqlFileContents = `
  import { p } from "@ponder/core";

  /**
   *  The entity types defined below map to database tables.
   * The functions you write in the \`src/\` directory are responsible for creating and updating records in these tables.
   * Your schema will be more flexible and powerful if it accurately models the logical relationships in your application's domain.
   *  Visit the [documentation](https://ponder.sh/guides/design-your-schema) or the 
   * [\`examples/\`](https://github.com/0xOlias/ponder/tree/main/examples) directory for further guidance on designing your schema.
   */
  export const schema = p.createSchema({
    ExampleTable: p.createTable({
      id: p.string(),
      name: p.string().optional(),
    }),
  });
`;

  writeFileSync(
    path.join(rootDir, "ponder.schema.ts"),
    await prettier.format(schemaGraphqlFileContents, { parser: "babel" }),
  );

  // Write the .env.local file.
  const uniqueChainIds = Array.from(
    new Set(config.networks.map((n) => n.chainId)),
  );
  const envLocal = `${uniqueChainIds.map(
    (chainId) => `PONDER_RPC_URL_${chainId}=""\n`,
  )}`;
  writeFileSync(path.join(rootDir, ".env.local"), envLocal);

  // Write the package.json file.
  const packageJson = `
    {
      "private": true,
      "scripts": {
        "dev": "ponder dev",
        "start": "ponder start",
        "codegen": "ponder codegen",
        ${options.eslint ? `"lint": "eslint .",` : ""}
      },
      "dependencies": {
        "@ponder/core": "^${ponderVersion}",
      },
      "devDependencies": {
        "@types/node": "^18.11.18",
        "abitype": "^0.8.11",
        ${options.eslint ? `"eslint": "^8.43.0",` : ""}
        ${options.eslint ? `"eslint-config-ponder": "^${ponderVersion}",` : ""}
        "typescript": "^5.1.3",
        "viem": "^1.2.6",
      }
    }
  `;
  writeFileSync(
    path.join(rootDir, "package.json"),
    await prettier.format(packageJson, { parser: "json" }),
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
        "rootDir": "."
      },
      "include": ["./**/*.ts"],
      "exclude": ["node_modules"]
    }
  `;
  writeFileSync(
    path.join(rootDir, "tsconfig.json"),
    await prettier.format(tsConfig, { parser: "json" }),
  );

  if (options.eslint) {
    const eslintConfig = `
    {
      "extends": "ponder"
    }
  `;

    writeFileSync(
      path.join(rootDir, ".eslintrc.json"),
      await prettier.format(eslintConfig, { parser: "json" }),
    );
  }

  // Write the .gitignore file.
  writeFileSync(
    path.join(rootDir, ".gitignore"),
    `# Dependencies
/node_modules

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# Misc
.DS_Store

# Env files
.env*.local

# Ponder
/generated/
/.ponder/

# TypeScript
ponder-env.d.ts`,
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
    pico.green("\nSuccess! ") + `Created ${options.projectName} at ${rootDir}`,
  );
};
