import BaseRegistrarImplementationAbi from "../abis/BaseRegistrarImplementation.json";

export const mainnet = { name: "mainnet", chainId: 1, rpcUrl: "rpc://test" };

export const BaseRegistrarImplementation = {
  name: "BaseRegistrarImplementation",
  network: "mainnet",
  abi: BaseRegistrarImplementationAbi,
  address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
  startBlock: 16370000,
  blockLimit: 100,
};

export const BaseRegistrarImplementationSchema = `
  type EnsNft @entity {
    id: ID!
    labelHash: String!
    owner: Account!
    transferredAt: Int!
  }

  type Account @entity {
    id: ID!
    tokens: [EnsNft!]! @derivedFrom(field: "owner")
    lastActive: Int!
  }
`;

export const BaseRegistrarImplementationHandlers = `
  const handleTransfer = async (event: any, context: any) => {
    await context.entities.EnsNft.upsert(event.params.tokenId.toString(), {
      owner: event.params.to,
      labelHash: event.params.tokenId.toHexString(),
      transferredAt: event.block.timestamp,
    });

    await context.entities.Account.upsert(event.params.from, {
      lastActive: event.block.timestamp,
    });

    await context.entities.Account.upsert(event.params.to, {
      lastActive: event.block.timestamp,
    });
  };

  export default {
    BaseRegistrarImplementation: {
      Transfer: handleTransfer,
    },
  };
`;
