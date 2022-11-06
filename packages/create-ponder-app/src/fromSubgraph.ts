import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import type {
  PartialPonderConfig,
  PonderNetwork,
  PonderSource,
} from "src/index";
import { parse } from "yaml";

import type { CreatePonderAppOptions } from "./bin/create-ponder-app";
import {
  getGraphProtocolChainId,
  subgraphYamlFileNames,
} from "./helpers/getGraphProtocolChainId";
import { validateGraphProtocolSource } from "./helpers/validateGraphProtocolSource";

export const fromSubgraph = (options: CreatePonderAppOptions) => {
  if (!options.fromSubgraph) {
    throw new Error(`Internal error: fromSubgraph undefined`);
  }

  const { ponderRootDir } = options;
  const subgraphRootDir = path.resolve(options.fromSubgraph);

  const ponderNetworks: PonderNetwork[] = [];
  let ponderSources: PonderSource[] = [];

  // If the `--from-subgraph` option was passed, parse subgraph files
  const subgraphRootDirPath = path.resolve(subgraphRootDir);

  // Read and parse the subgraph YAML file.
  let subgraphYamlRaw = "";

  for (const subgraphYamlFileName of subgraphYamlFileNames) {
    try {
      subgraphYamlRaw = readFileSync(
        path.join(subgraphRootDirPath, subgraphYamlFileName),
        {
          encoding: "utf-8",
        }
      );
      break;
    } catch (e) {
      continue;
    }
  }

  if (subgraphYamlRaw === "") {
    throw new Error(`subgraph.yaml file not found`);
  }

  const subgraphYaml = parse(subgraphYamlRaw);

  // Copy over the schema.graphql file.
  const subgraphSchemaFilePath = path.join(
    subgraphRootDirPath,
    subgraphYaml.schema.file
  );
  const ponderSchemaFilePath = path.join(ponderRootDir, "schema.graphql");
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

      if (!ponderNetworks.map((n) => n.name).includes(network)) {
        ponderNetworks.push({
          kind: "evm",
          name: network,
          chainId: chainId,
          rpcUrl: `process.env.PONDER_RPC_URL_${chainId}`,
        });
      }

      // Copy the ABI file.
      const abiAbsolutePath = path.join(subgraphRootDirPath, abiPath);
      const abiFileName = path.basename(abiPath);

      const ponderAbiRelativePath = `./abis/${abiFileName}`;
      const ponderAbiAbsolutePath = path.join(
        ponderRootDir,
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
        path.join(ponderRootDir, `./handlers/${source.name}.ts`),
        prettier.format(handlerFileContents, { parser: "typescript" })
      );

      return <PonderSource>{
        kind: "evm",
        name: source.name,
        network: network,
        address: source.source.address,
        abi: ponderAbiRelativePath,
        startBlock: source.source.startBlock,
      };
    });

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
    path.join(ponderRootDir, `./handlers/index.ts`),
    prettier.format(handlerIndexFileContents, { parser: "typescript" })
  );

  // Build the partial ponder config.
  const ponderConfig: PartialPonderConfig = {
    plugins: ["graphqlPlugin()"],
    database: {
      kind: "sqlite",
    },
    networks: ponderNetworks,
    sources: ponderSources,
  };

  return ponderConfig;
};
