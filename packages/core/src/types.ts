// --------------------------- BLOCKCHAIN DATA TYPES --------------------------- //

export interface Block {
  hash: string;
  number: number;
  timestamp: number;

  gasLimit: string; // BigNumber
  gasUsed: string; // BigNumber
  baseFeePerGas: string; // BigNumber

  miner: string;
  extraData: string;
  size: number;

  parentHash: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  totalDifficulty: string; // BigNumber
}

export interface Transaction {
  hash: string;
  nonce: number;

  from: string;
  to?: string; // null if contract creation
  value: string; // BigNumber
  input: string;

  gas: string; // BigNumber
  gasPrice: string; // BigNumber
  maxFeePerGas?: string; // BigNumber
  maxPriorityFeePerGas?: string; // BigNumber

  blockHash: string;
  blockNumber: number;
  transactionIndex: number;
  chainId: number;
}

export interface Log {
  logId: string; // `${log.blockHash}-${log.logIndex}`
  logSortKey: number;

  address: string;
  data: string;
  topic0?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;

  blockHash: string;
  blockNumber: number;
  logIndex: number;

  transactionHash: string;
  transactionIndex: number;

  removed: number; // boolean, 0 or 1
}
