import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { parse } from "yaml";

import { getPackageManager } from "./helpers/getPackageManager";

// https://github.com/graphprotocol/graph-cli/blob/main/src/protocols/index.js#L40
// https://chainlist.org/
const chainIdByGraphNetwork: Record<string, number | undefined> = {
  mainnet: 1,
  kovan: 42,
  rinkeby: 4,
  ropsten: 3,
  goerli: 5,
  "poa-core": 99,
  "poa-sokol": 77,
  xdai: 100,
  matic: 137,
  mumbai: 80001,
  fantom: 250,
  "fantom-testnet": 4002,
  bsc: 56,
  chapel: -1,
  clover: 0,
  avalanche: 43114,
  fuji: 43113,
  celo: 42220,
  "celo-alfajores": 44787,
  fuse: 122,
  moonbeam: 1284,
  moonriver: 1285,
  mbase: -1,
  "arbitrum-one": 42161,
  "arbitrum-rinkeby": 421611,
  optimism: 10,
  "optimism-kovan": 69,
  aurora: 1313161554,
  "aurora-testnet": 1313161555,
};

export { chainIdByGraphNetwork };

// https://github.com/graphprotocol/graph-node/blob/master/docs/subgraph-manifest.md
type GraphSource = {
  kind: string; // Should be "ethereum"
  name: string;
  network: string;
  source: {
    address: string;
    abi: string; // Keys into dataSource.mapping.abis
    startBlock?: number;
  };
  mapping: {
    kind: string; // Should be "ethereum/events"
    apiVersion: string;
    language: string; // Should be "wasm/assemblyscript"
    entities: string[]; // Corresponds to entities by name defined in schema.graphql
    abis: {
      name: string;
      file: string;
    }[];
    eventHandlers?: {
      event: string;
      handler: string;
      topic0?: string;
    }[];
    // NOTE: Not planning to support callHandlers or blockHandlers.
    // callHandlers?: {
    //   function: string;
    //   handler: string;
    // }[];
    // blockHandlers?: {
    //   handler: string;
    //   filter?: {
    //     kind: string;
    //   };
    // }[];
    file: string; // relative path to file that contains handlers for this source
  };
};

type PonderSource = {
  kind: "evm";
  name: string;
  chainId: number;
  rpcUrl: string;
  abi: string;
  address: string;
  startBlock?: number;
};

export const run = (ponderRootDir: string, subgraphRootDir: string) => {
  const subgraphRootDirPath = path.resolve(subgraphRootDir);
  const ponderRootDirPath = path.resolve(ponderRootDir);

  // Create all required directories.
  mkdirSync(path.join(ponderRootDirPath, "abis"), { recursive: true });
  mkdirSync(path.join(ponderRootDirPath, "handlers"), { recursive: true });

  // Read and parse the subgraph YAML file.
  const subgraphYamlFilePath = path.join(subgraphRootDirPath, "subgraph.yaml");

  const subgraphYamlRaw = readFileSync(subgraphYamlFilePath, {
    encoding: "utf-8",
  });
  const subgraphYaml = parse(subgraphYamlRaw);

  // Copy over the schema.graphql file.
  const subgraphSchemaFilePath = path.resolve(subgraphYaml.schema.file);
  const ponderSchemaFilePath = path.join(ponderRootDirPath, "schema.graphql");
  copyFileSync(subgraphSchemaFilePath, ponderSchemaFilePath);

  // Build the ponder sources. Also copy over the ABI files for each source.
  const ponderSources = (subgraphYaml.dataSources as GraphSource[]).map(
    (source) => {
      const abiPath = source.mapping.abis.find(
        (abi) => abi.name === source.name
      )?.file;
      if (!abiPath) {
        throw new Error(`ABI path not found for source: ${source.name}`);
      }

      const chainId = chainIdByGraphNetwork[source.network];
      if (!chainId || chainId === -1) {
        throw new Error(`Unhandled network name: ${source.network}`);
      }

      // Copy the ABI file.
      const abiAbsolutePath = path.resolve(abiPath);
      const abiFileName = path.basename(abiPath);

      const ponderAbiRelativePath = `./abis/${abiFileName}`;
      const ponderAbiAbsolutePath = path.resolve(
        ponderRootDirPath,
        ponderAbiRelativePath
      );

      copyFileSync(abiAbsolutePath, ponderAbiAbsolutePath);

      // Generate a template handlers file.
      const handlers = (source.mapping.eventHandlers || []).map((handler) => {
        const eventBaseName = handler.event.split("(")[0];

        const handlerFunctionType = `${eventBaseName}Handler`;
        const handlerFunctionName = `handle${eventBaseName}`;

        return {
          handlerFunctionType,
          handlerFunction: `const ${handlerFunctionName}: ${handlerFunctionType} = async (event, context) => {
            return
          }
          `,
          handlerExport: `${eventBaseName}: ${handlerFunctionName}`,
        };
      });

      const handlerFileContents = `
        import { ${handlers.map((h) => h.handlerFunctionType).join(",")} }
          from './generated/${source.name}.ts'

        ${handlers.map((h) => h.handlerFunction).join("\n")}
        
        export default {
          ${handlers.map((h) => h.handlerExport).join(",")}
        }
      `;

      writeFileSync(
        path.resolve(ponderRootDirPath, `./handlers/${source.name}.ts`),
        prettier.format(handlerFileContents, { parser: "typescript" })
      );

      return <PonderSource>{
        kind: "evm",
        name: source.name,
        chainId: chainId,
        rpcUrl: `process.env.PONDER_RPC_URL_${chainId}`,
        address: source.source.address,
        abi: ponderAbiRelativePath,
        startBlock: source.source.startBlock,
      };
    }
  );

  // Write the ponder.config.js file.
  const ponderConfig = {
    sources: ponderSources,
    apis: [
      {
        kind: "graphql",
        default: true,
        port: 42069,
      },
    ],
    stores: [
      {
        kind: "sqlite",
        filename: ":memory:",
      },
    ],
  };

  const finalPonderConfig = (
    "module.exports = " + JSON.stringify(ponderConfig)
  ).replaceAll(
    /"process.env.PONDER_RPC_URL_(.*?)"/g,
    "process.env.PONDER_RPC_URL_$1"
  );

  writeFileSync(
    path.join(ponderRootDirPath, "ponder.config.js"),
    prettier.format(finalPonderConfig, { parser: "babel" })
  );

  // Write the .env.local file.
  const uniqueChainIds = Array.from(
    new Set(ponderConfig.sources.map((s) => s.chainId))
  );
  const envLocal = `${uniqueChainIds.map(
    (chainId) => `PONDER_RPC_URL_${chainId}=""\n`
  )}`;
  writeFileSync(path.join(ponderRootDirPath, ".env.local"), envLocal);

  // Write the package.json file.
  const packageJson = `
    {
      "name": "",
      "version": "0.1.0",
      "private": true,
      "scripts": {
        "dev": "ponder dev",
        "start": "ponder start",
      },
      "dependencies": {
        "@ponder/ponder": "^0.0.8",
      },
    }
  `;
  writeFileSync(
    path.join(ponderRootDirPath, "package.json"),
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
    path.join(ponderRootDirPath, "tsconfig.json"),
    prettier.format(tsConfig, { parser: "json" })
  );

  // Write the .gitignore file.
  writeFileSync(
    path.join(ponderRootDirPath, ".gitignore"),
    `.env.local\n.ponder/\ngenerated/`
  );

  // Now, move into the newly created directory, install packages, and run `ponder dev`.
  process.chdir(ponderRootDirPath);

  const packageManager = getPackageManager();
  console.log(`Installing using ${packageManager}`);

  const command = [packageManager, "install"].join(" ");
  try {
    execSync(command, {
      // stdio: "inherit",
      env: {
        ...process.env,
        ADBLOCK: "1",
        // we set NODE_ENV to development as pnpm skips dev
        // dependencies when production
        NODE_ENV: "development",
        DISABLE_OPENCOLLECTIVE: "1",
      },
    });
  } catch (err) {
    console.log(`Unable to install dependencies: ${err}`);
  }

  console.log(`Successfully installed dependencies.`);

  console.log(
    `Go to ${ponderRootDir} and run \`ponder dev\` to start the development server.`
  );
};
