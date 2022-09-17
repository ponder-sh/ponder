import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { parse } from "yaml";

import { getGraphProtocolChainId } from "./helpers/getGraphProtocolChainId";
import { getPackageManager } from "./helpers/getPackageManager";
import { validateGraphProtocolSource } from "./helpers/validateGraphProtocolSource";

type PonderSource = {
  kind: "evm";
  name: string;
  chainId: number;
  rpcUrl: string;
  abi: string;
  address: string;
  startBlock?: number;
};

export const run = (ponderRootDir: string, subgraphRootDir?: string) => {
  const ponderRootDirPath = path.resolve(ponderRootDir);

  // Create all required directories.
  mkdirSync(path.join(ponderRootDirPath, "abis"), { recursive: true });
  mkdirSync(path.join(ponderRootDirPath, "handlers"), { recursive: true });

  let ponderSources: PonderSource[] = [];

  if (subgraphRootDir) {
    // If the `--from-subgraph` option was passed, parse subgraph files
    const subgraphRootDirPath = path.resolve(subgraphRootDir);

    // Read and parse the subgraph YAML file.
    let subgraphYamlRaw: string;

    if (existsSync(path.join(subgraphRootDirPath, "subgraph.yaml"))) {
      subgraphYamlRaw = readFileSync(
        path.join(subgraphRootDirPath, "subgraph.yaml"),
        {
          encoding: "utf-8",
        }
      );
    } else if (
      existsSync(path.join(subgraphRootDirPath, "subgraph-mainnet.yaml"))
    ) {
      // This is a hack, need to think about how to handle different networks.
      subgraphYamlRaw = readFileSync(
        path.join(subgraphRootDirPath, "subgraph-mainnet.yaml"),
        {
          encoding: "utf-8",
        }
      );
    } else {
      throw new Error(`subgraph.yaml file not found`);
    }

    const subgraphYaml = parse(subgraphYamlRaw);

    // Copy over the schema.graphql file.
    const subgraphSchemaFilePath = path.join(
      subgraphRootDirPath,
      subgraphYaml.schema.file
    );
    const ponderSchemaFilePath = path.join(ponderRootDirPath, "schema.graphql");
    copyFileSync(subgraphSchemaFilePath, ponderSchemaFilePath);

    // Build the ponder sources. Also copy over the ABI files for each source.
    ponderSources = (subgraphYaml.dataSources as unknown[])
      .map(validateGraphProtocolSource)
      .map((source) => {
        const abiPath = source.mapping.abis.find(
          (abi) => abi.name === source.name
        )?.file;
        if (!abiPath) {
          throw new Error(`ABI path not found for source: ${source.name}`);
        }

        const network = source.network || "mainnet";
        const chainId = getGraphProtocolChainId(network);
        if (!chainId || chainId === -1) {
          throw new Error(`Unhandled network name: ${network}`);
        }

        // Copy the ABI file.
        const abiAbsolutePath = path.join(subgraphRootDirPath, abiPath);
        const abiFileName = path.basename(abiPath);

        const ponderAbiRelativePath = `./abis/${abiFileName}`;
        const ponderAbiAbsolutePath = path.join(
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
          from '../generated/${source.name}'

        ${handlers.map((h) => h.handlerFunction).join("\n")}
        
        export const ${source.name} = {
          ${handlers.map((h) => h.handlerExport).join(",")}
        }
      `;

        writeFileSync(
          path.join(ponderRootDirPath, `./handlers/${source.name}.ts`),
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
      });
  } else {
    // If the `--from-subgraph` option was not passed, generate empty/default files

    const abiFileContents = `[]`;

    const abiRelativePath = "./abis/ExampleContract.json";
    const abiAbsolutePath = path.join(ponderRootDirPath, abiRelativePath);
    writeFileSync(abiAbsolutePath, abiFileContents);

    ponderSources = [
      {
        kind: "evm",
        name: "ExampleContract",
        chainId: 1,
        rpcUrl: `process.env.PONDER_RPC_URL_1`,
        address: "0x0",
        abi: abiRelativePath,
        startBlock: 1234567,
      },
    ];

    const schemaGraphqlFileContents = `
      type ExampleToken @entity {
        id: ID!
        tokenId: Int!
        trait: TokenTrait!
      }

      enum TokenTrait {
        GOOD
        BAD
      }
    `;

    // Generate the schema.graphql file.
    const ponderSchemaFilePath = path.join(ponderRootDirPath, "schema.graphql");
    writeFileSync(ponderSchemaFilePath, schemaGraphqlFileContents);
  }

  // Write the handler index.ts file.
  const handlerIndexFileContents = `
    ${ponderSources
      .map((source) => `import { ${source.name} } from "./${source.name}"`)
      .join("\n")}

    export default {
      ${ponderSources
        .map((source) => `${source.name}: ${source.name}`)
        .join(",")}
    }
  `;
  writeFileSync(
    path.join(ponderRootDirPath, `./handlers/index.ts`),
    prettier.format(handlerIndexFileContents, { parser: "typescript" })
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
        "@ponder/ponder": "latest",
      },
      "engines": {
        "node": "16",
        "pnpm": "7"
      }
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
