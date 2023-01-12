import { graphqlPlugin } from "../../../graphql/dist";

export default () => {
  return {
    plugins: [graphqlPlugin()],
    database: {
      kind: "sqlite",
      filename: ":memory:",
    },
    networks: [
      {
        name: "mainnet",
        chainId: 1,
        rpcUrl: "rpc://test",
      },
    ],
    sources: [
      {
        name: "BaseRegistrarImplementation",
        network: "mainnet",
        abi: "./abis/BaseRegistrarImplementation.json",
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        blockLimit: 100,
      },
    ],
  };
};
