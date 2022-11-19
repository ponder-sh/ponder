import { writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import type { PartialPonderConfig } from "src/index";

import type { CreatePonderOptions } from "../bin/create-ponder";

export const fromBasic = (options: CreatePonderOptions) => {
  const { ponderRootDir } = options;

  const abiFileContents = `[]`;

  const abiRelativePath = "./abis/ExampleContract.json";
  const abiAbsolutePath = path.join(ponderRootDir, abiRelativePath);
  writeFileSync(abiAbsolutePath, abiFileContents);

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
  const ponderSchemaFilePath = path.join(ponderRootDir, "schema.graphql");
  writeFileSync(
    ponderSchemaFilePath,
    prettier.format(schemaGraphqlFileContents, { parser: "graphql" })
  );

  // Build the partial ponder config.
  const ponderConfig: PartialPonderConfig = {
    plugins: ["graphqlPlugin()"],
    database: {
      kind: "sqlite",
    },
    networks: [
      {
        kind: "evm",
        name: "mainnet",
        chainId: 1,
        rpcUrl: `process.env.PONDER_RPC_URL_1`,
      },
    ],
    sources: [
      {
        kind: "evm",
        name: "ExampleContract",
        network: "mainnet",
        address: "0x0",
        abi: abiRelativePath,
        startBlock: 1234567,
      },
    ],
  };

  return ponderConfig;
};
