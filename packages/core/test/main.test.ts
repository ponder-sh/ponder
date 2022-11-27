import { Ponder } from "@/Ponder";

jest.mock("@ethersproject/providers", () => {
  const originalModule = jest.requireActual("@ethersproject/providers");
  const StaticJsonRpcProvider = originalModule.StaticJsonRpcProvider;

  class MockedStaticJsonRpcProvider extends StaticJsonRpcProvider {
    constructor(url: unknown, chainId: unknown) {
      super(url, chainId);
    }

    async send(method: string, params: Array<unknown>) {
      console.log({ method, params });

      return null;
    }
  }

  return {
    __esModule: true,
    ...originalModule,
    StaticJsonRpcProvider: MockedStaticJsonRpcProvider,
  };
});

const abi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "string",
        name: "indexedFilename",
        type: "string",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "checksum",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "string",
        name: "filename",
        type: "string",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "size",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "metadata",
        type: "bytes",
      },
    ],
    name: "FileCreated",
    type: "event",
  },
];

const ponder = new Ponder({
  database: {
    kind: "sqlite",
  },
  networks: [
    {
      kind: "evm",
      name: "mainnet",
      chainId: 1,
      rpcUrl: "rpc://test",
    },
  ],
  sources: [
    {
      kind: "evm",
      name: "FileStore",
      network: "mainnet",
      abi: abi,
      address: "0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      startBlock: 15963553,
    },
  ],
});

ponder.on("asd", () => {
  console.log("kek");
});
