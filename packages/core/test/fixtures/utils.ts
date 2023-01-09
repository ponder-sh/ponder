export type Hash = `0x${string}`;

export const toHex = (num: number): Hash => `0x${num.toString(16)}`;
export const toNumber = (hex: string) => parseInt(hex.slice(2), 16);

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
