export type Hash = `0x${string}`;

export const toHex = (num: number): Hash => `0x${num.toString(16)}`;
export const toNumber = (hex: Hash) => parseInt(hex.slice(2), 16);

export const randomHex = (size = 16): Hash =>
  `0x${[...Array(size)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("")}`;

type RawBlock = {
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
};

const getDefaultBlock = (): RawBlock => ({
  baseFeePerGas: randomHex(9),
  difficulty: randomHex(1),
  extraData: randomHex(30),
  gasLimit: randomHex(7),
  gasUsed: randomHex(7),
  hash: randomHex(64),
  logsBloom: randomHex(128),
  miner: randomHex(40),
  mixHash: randomHex(64),
  nonce: randomHex(16),
  number: randomHex(6),
  parentHash: randomHex(64),
  receiptsRoot: randomHex(64),
  sha3Uncles: randomHex(64),
  size: randomHex(5),
  stateRoot: randomHex(64),
  timestamp: randomHex(8),
  totalDifficulty: randomHex(19),
  transactions: [],
  transactionsRoot: randomHex(64),
  uncles: [],
});

export const mockBlock = (block: Partial<RawBlock> = {}): RawBlock => {
  return { ...getDefaultBlock(), ...block };
};

type RawLog = {
  address: Hash;
  blockHash: Hash;
  blockNumber: Hash;
  data: Hash;
  logIndex: Hash;
  removed: boolean;
  topics: Hash[];
  transactionHash: Hash;
  transactionIndex: Hash;
};

const getDefaultLog = (): RawLog => ({
  address: randomHex(40),
  blockHash: randomHex(64),
  blockNumber: randomHex(6),
  data: randomHex(64),
  logIndex: randomHex(2),
  removed: false,
  topics: [],
  transactionHash: randomHex(64),
  transactionIndex: randomHex(2),
});

export const mockLog = (log: Partial<RawLog> = {}): RawLog => {
  return { ...getDefaultLog(), ...log };
};
