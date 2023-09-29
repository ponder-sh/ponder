import { writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { http } from "viem";

import type { PartialConfig } from "@/index";

export const fromBasic = ({ rootDir }: { rootDir: string }) => {
  const abiFileContents = `[]`;

  const abiRelativePath = "./abis/ExampleContract.json";
  const abiAbsolutePath = path.join(rootDir, abiRelativePath);
  writeFileSync(abiAbsolutePath, abiFileContents);

  const schemaGraphqlFileContents = `
    # The entity types defined below map to database tables.
    # The functions you write as event handlers inside the \`src/\` directory are responsible for creating and updating records in those tables.
    # Your schema will be more flexible and powerful if it accurately models the logical relationships in your application's domain.
    # Visit the [documentation](https://ponder.sh/guides/design-your-schema) or the [\`examples/\`](https://github.com/0xOlias/ponder/tree/main/examples) directory for further guidance on designing your schema.

    type ExampleToken @entity {
      id: String!
      tokenId: Int!
      trait: TokenTrait!
    }

    enum TokenTrait {
      GOOD
      BAD
    }
`;

  // Generate the schema.graphql file.
  const ponderSchemaFilePath = path.join(rootDir, "schema.graphql");
  writeFileSync(
    ponderSchemaFilePath,
    prettier.format(schemaGraphqlFileContents, { parser: "graphql" })
  );

  // Build the partial ponder config.
  const config: PartialConfig = {
    networks: [
      {
        name: "mainnet",
        chainId: 1,
        transport: http(`process.env.PONDER_RPC_URL_1`),
      },
    ],
    contracts: [
      {
        name: "ExampleContract",
        network: "mainnet",
        address: "0x0",
        abi: abiRelativePath,
        startBlock: 1234567,
      },
    ],
  };

  return config;
};
