/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import _BaseRegistrarImplementation from "../__fixtures__/BaseRegistrarImplementation";
// @ts-ignore
import _Contract from "../__fixtures__/Contract";

export type Hash = `0x${string}`;

export interface RawBlock {
  baseFeePerGas: Hash;
  difficulty: Hash;
  extraData: Hash;
  gasLimit: Hash;
  gasUsed: Hash;
  hash: Hash;
  logsBloom: Hash;
  miner: Hash;
  mixHash: Hash;
  nonce: Hash;
  number: Hash;
  parentHash: Hash;
  receiptsRoot: Hash;
  sha3Uncles: Hash;
  size: Hash;
  stateRoot: Hash;
  timestamp: Hash;
  totalDifficulty: Hash;
  transactions: Hash[];
  transactionsRoot: Hash;
  uncles: Hash[];
}

export interface RawBlockWithTransactions
  extends Omit<RawBlock, "transactions"> {
  transactions: RawTransaction[];
}

export interface RawTransaction {
  blockHash: Hash;
  blockNumber: Hash;
  hash: Hash;
  accessList: [];
  chainId: Hash;
  from: Hash;
  gas: Hash;
  gasPrice: Hash;
  input: Hash;
  maxFeePerGas: Hash;
  maxPriorityFeePerGas: Hash;
  nonce: Hash;
  r: Hash;
  s: Hash;
  to: Hash;
  transactionIndex: Hash;
  type: Hash;
  v: Hash;
  value: Hash;
}

export interface RawLog {
  address: Hash;
  blockHash: Hash;
  blockNumber: Hash;
  data: Hash;
  logIndex: Hash;
  removed: boolean;
  topics: Hash[];
  transactionHash: Hash;
  transactionIndex: Hash;
}

type Fixture = {
  name: string;
  logs: RawLog[];
  blocks: RawBlockWithTransactions[];
};

const fixtures = {
  BaseRegistrarImplementation:
    _BaseRegistrarImplementation as unknown as Fixture,
  Contract: _Contract as unknown as Fixture,
};

type SendArgs =
  | ["eth_getBlockByNumber", ["latest" | Hash, boolean]]
  | ["eth_getBlockByHash", ["latest" | Hash, boolean]]
  | ["eth_getLogs", [{ address: Hash[]; fromBlock: Hash; toBlock: Hash }]];

type FixtureOption = keyof typeof fixtures;

export const buildSendFunc = (option: FixtureOption) => {
  const { logs, blocks } = fixtures[option];

  return async (...args: any) => {
    const [method, params] = args as SendArgs;

    let response: RawBlock | RawBlockWithTransactions | RawLog[];

    switch (method) {
      case "eth_getBlockByNumber": {
        const [number, includeTransactions] = params;

        let block: RawBlockWithTransactions;
        if (number === "latest") {
          block = blocks.sort((a, b) => b.number.localeCompare(a.number))[0];
        } else {
          const found = blocks.find((l) => l.number === number);
          if (!found) {
            console.log("not found:", {
              number,
              firstBlockNumber: blocks[0]?.number,
            });

            throw new Error(
              `Block with number ${number} not found in fixture ${option}`
            );
          }
          block = found;
        }

        if (includeTransactions) {
          response = block;
          break;
        } else {
          response = <RawBlock>{
            ...block,
            transactions: block.transactions.map((t) => t.hash),
          };
          break;
        }
      }
      case "eth_getBlockByHash": {
        const [hash, includeTransactions] = params;

        let block: RawBlockWithTransactions;
        if (hash === "latest") {
          block = blocks.sort((a, b) => b.number.localeCompare(a.number))[0];
        } else {
          const found = blocks.find((l) => l.hash === hash);
          if (!found)
            throw new Error(
              `Block with hash ${hash} not found in fixture ${option}`
            );
          block = found;
        }

        if (includeTransactions) {
          response = block;
          break;
        } else {
          response = <RawBlock>{
            ...block,
            transactions: block.transactions.map((t) => t.hash),
          };
          break;
        }
      }
      case "eth_getLogs": {
        const [{ address, fromBlock, toBlock }] = params;
        const addressSet = new Set(address);
        const foundLogs = logs
          .filter((l) => addressSet.has(l.address))
          .filter(
            (l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock
          );

        response = foundLogs;
        break;
      }
      default: {
        throw new Error(
          `MockedStaticJsonRpcProvider: Unhandled method ${method}`
        );
      }
    }

    return response;
  };
};
