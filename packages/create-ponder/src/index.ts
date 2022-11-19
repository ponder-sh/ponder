import { ethers } from "ethers";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pico from "picocolors";
import prettier from "prettier";

import type { CreatePonderOptions } from "./bin/create-ponder";
import { detect } from "./helpers/detectPackageManager";
import { fromBasic } from "./templates/basic";
import { fromEtherscan } from "./templates/etherscan";
import { fromSubgraph } from "./templates/subgraph";

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

export const run = async (options: CreatePonderOptions) => {
  const { ponderRootDir } = options;

  // Create required directories.
  mkdirSync(path.join(ponderRootDir, "abis"), { recursive: true });
  mkdirSync(path.join(ponderRootDir, "handlers"), { recursive: true });

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

    const handlers = eventNames.map((eventName) => {
      const eventBaseName = eventName.split("(")[0];

      const handlerFunctionType = `${eventBaseName}Handler`;
      const handlerFunctionName = `handle${eventBaseName}`;

      return {
        handlerFunctionType,
        handlerFunction: `const ${handlerFunctionName}: ${handlerFunctionType} = async (event, context) => { return }\n`,
        handlerExport: `${eventBaseName}: ${handlerFunctionName}`,
      };
    });

    const handlerFileContents = `
      import { ${handlers.map((h) => h.handlerFunctionType).join(",")} }
        from '../generated/handlers'

      ${handlers.map((h) => h.handlerFunction).join("\n")}
      
      export const ${source.name} = {
        ${handlers.map((h) => h.handlerExport).join(",")}
      }
    `;

    writeFileSync(
      path.join(ponderRootDir, `./handlers/${source.name}.ts`),
      prettier.format(handlerFileContents, { parser: "typescript" })
    );
  });

  // Write the handler index.ts file.
  const handlerIndexFileContents = `
    ${ponderConfig.sources
      .map((source) => `import { ${source.name} } from "./${source.name}"`)
      .join("\n")}
      
    export default {
      ${ponderConfig.sources
        .map((source) => `${source.name}: ${source.name}`)
        .join(",")}
    }
  `;
  writeFileSync(
    path.join(ponderRootDir, `./handlers/index.ts`),
    prettier.format(handlerIndexFileContents, { parser: "typescript" })
  );

  // Write the ponder.config.js file.
  const finalPonderConfig = `const { graphqlPlugin } = require("@ponder/graphql");

/**
 * @type {import('@ponder/core').PonderConfig}
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

  // Write the render.yaml file
  const renderYaml = `
# This file was generated by \`create-ponder\`. You can deploy your Ponder app
# by signing in to https://render.com, connecting this repository, and clicking Deploy.

services:
  - type: web
    name: ponder-app
    env: node
    buildCommand: ${packageManager} install
    startCommand: ${packageManager} run start
    envVars:
      - key: POSTGRES_URL
        fromDatabase:
          name: ponder-db
          property: connectionString
${ponderConfig.networks
  .map((n) => `      - key: PONDER_RPC_URL_${n.chainId}\n        sync: false`)
  .join("\n")}

databases:
  - name: ponder-db
    postgresMajorVersion: 14
  `;
  writeFileSync(
    path.join(ponderRootDir, "render.yaml"),
    prettier.format(renderYaml, { parser: "yaml" })
  );

  // Install packages.
  console.log(
    pico.cyan("[create-ponder] ") + `Installing using ${packageManager}`
  );

  execSync(`${packageManager} install`, {
    cwd: ponderRootDir,
    stdio: "inherit",
  });

  // Run codegen.
  console.log(pico.cyan("[create-ponder] ") + `Generating types`);

  execSync(`${packageManager} run  --silent codegen`, {
    cwd: ponderRootDir,
    stdio: "inherit",
  });

  console.log(
    pico.cyan("[create-ponder] ") +
      pico.green("Done! ") +
      `To get started: ${pico.yellow(
        `cd ${path.relative(".", ponderRootDir)} && ${packageManager} run dev`
      )}`
  );
};
