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
        "codegen": "ponder codegen",
        "docker:dev": "docker-compose up --build"
      },
      "dependencies": {
        "@ponder/core": "latest"
      },
      "devDependencies": {
        "@types/node": "^18.11.18",
        "abitype": "^0.6.7",
        "typescript": "^4.9.5",
        "viem": "0.1.6"
      }
    }
  `;
  writeFileSync(
    path.join(rootDir, "package.json"),
    prettier.format(packageJson, { parser: "json" })
  );

  // TODO need to pass in env variables
  // TODO need to set host to 0.0.0.0 instead of localhost
  //    the port mapping won't work til it's 0.0.0.0
  const dockerfile = `# A slim node image that is easy to maintain
FROM node:18.16.0-bullseye-slim

WORKDIR /ponder

# install pnpm package manager
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm

# copy only pnpm-lock.yaml so docker caches
# the installation of deps when it's unchanged
COPY pnpm-lock.yaml ./

# TODO ask user to configure env variables

# install deps into pnpm store
RUN pnpm fetch --prod

COPY . ./
RUN pnpm install -r --offline --prod

EXPOSE 42069
# TODO we need to pass in env variable to make host 0.0.0.0 instead of localhost
CMD [ "pnpm", "start" ]
`;

  const dockerIgnore = `.git
.github
.vscode
lib
node_modules
.env
**/.env
forge-artifacts
cache
`;

  // TODO need to fill out env variables
  const dockerCompose = `version: "3.8"  
services:
  ponder:
    build: .
    ports:
      - "42069:42069"
    command: pnpm dev
    # mount the current directory into container so server
    # can reload
    volumes:
      - .:/ponder
    healthcheck:
      test: curl http://0.0.0.0:42069
    environment:
      # TODO fill this out
      # TODO how do I pass in a DATABASE_URL
      - DATABASE_URL=\${DATABASE_URL:-postgresql://db_username:db_password@postgres:5432/db_name}
    depends_on:
      postgres:
        condition: service_health

  postgres:
    image: postgres:latest
    environment:
      - POSTGRES_USER=db_username
      - POSTGRES_PASSWORD=db_password
      - POSTGRES_DB=db_name
      - PGDATA=/data/postgres
      - POSTGRES_HOST_AUTH_METHOD=trust
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -q -U db_username -d db_name" ]
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/data/postgres

volumes:
  postgres_data:
`;

  writeFileSync(path.join(rootDir, "Dockerfile"), dockerfile);
  writeFileSync(path.join(rootDir, ".dockerIgnore"), dockerIgnore);
  writeFileSync(path.join(rootDir, "docker-compose.yaml"), dockerCompose);

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
