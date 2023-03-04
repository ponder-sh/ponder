import type { Block, Log, Transaction } from "@/database/types";

export const hexStringToDecimal = (value: string | number) => {
  return typeof value === "string"
    ? parseInt((value as string).slice(2), 16)
    : value;
};

/*
  Sample block object from `eth_getBlockByHash(blockHash, true)` response from Alchemy:
  {
    number: '0xf0a29a',
    hash: '0x7ee22c49b9316dc9012f765574fff6835c344a6e79eb5a915321f0d2c6c027cf',
    transactions: [
      [Object]
    ],
    difficulty: '0x0',
    extraData: '0x406275696c64657230783639',
    gasLimit: '0x1c9c380',
    gasUsed: '0x176cc48',
    logsBloom: '0x90e25004f3ce6986b5486006b95195fe13b516c668480bbb4013a0a3bcfc5902a755dbc,
    miner: '0x690b9a9e9aa1c9db991c7721a92d351db4fac990',
    mixHash: '0x3b78b15e976acf034d6ad5deef1661af8181158ae7a0f61d03485ba0b25673af',
    nonce: '0x0000000000000000',
    parentHash: '0x402c9228ad399a91480dc7cde04c66bbd0315306e9787ce8b9633b118035f166',
    receiptsRoot: '0x94b83de00761897f17064d1d18653e303ee53b15b3c90eb5236ca9cbf23ca169',
    sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
    size: '0x1d00f',
    stateRoot: '0x1546d02556a646a51a53e179f8456804d225c3c5caf90f46285b0f5f94dc18ad',
    timestamp: '0x634dbd7b',
    totalDifficulty: '0xc70d815d562d3cfa955',
    transactionsRoot: '0x262afc56ad876f24fb3d922077017a32382d723fcb4f951380bf65b8eafcbb97,
    uncles: [],
    baseFeePerGas: '0x6c4c5e6a1'
  }

  The argument is typed as any here for convenience, because ethers does not
  seem to export types that correspond to the return type of the raw RPC methods.
*/
export const parseBlock = (block: any): Block => ({
  number: hexStringToDecimal(block.number),
  hash: block.hash,
  timestamp: hexStringToDecimal(block.timestamp),

  gasLimit: block.gasLimit, // BigNumber
  gasUsed: block.gasUsed, // BigNumber
  // TODO: Update the approach here to avoid RPC response object inconsistencies
  // getting swallowed by SQLite, see https://github.com/0xOlias/ponder/issues/82
  baseFeePerGas: block.baseFeePerGas ?? "0x0", // BigNumber

  miner: block.miner,
  extraData: block.extraData,
  size: hexStringToDecimal(block.size),

  parentHash: block.parentHash,
  stateRoot: block.stateRoot,
  transactionsRoot: block.transactionsRoot,
  receiptsRoot: block.receiptsRoot,
  logsBloom: block.logsBloom,
  totalDifficulty: block.totalDifficulty, // BigNumber
});

/*
  Sample transaction from `eth_getBlockByHash(blockHash, true)` response from Alchemy:
  {
    blockHash: '0x7ee22c49b9316dc9012f765574fff6835c344a6e79eb5a915321f0d2c6c027cf',
    blockNumber: '0xf0a29a',
    hash: '0x47cc11cca356d2141769333262e79849565a32d041c80b2e774471e0216c9a81',
    accessList: [],
    chainId: '0x1',
    from: '0x69de5e18113ee6ea8a69cb46cabda371d5e581d6',
    gas: '0x2d950',
    gasPrice: '0x73bfb7aa1',
    input: '0x5ae401dc00000000000000000000000000000000000000000000000000000000634dc46b000,
    maxFeePerGas: '0x9c7652400',
    maxPriorityFeePerGas: '0x77359400',
    nonce: '0x7d6',
    r: '0x95c727e0c43c55a0008a9681f5936dc5c6f0379ca0e677eca03cc6a91157f9bd',
    s: '0x986a21a8bd094286bd11af68d15aab9b0a010414c0437487a4ac571c61a7a29',
    to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    transactionIndex: '0x0',
    type: '0x2',
    v: '0x0',
    value: '0xde0b6b3a7640000'
  }

  The argument is typed as any here for convenience, because ethers does not
  seem to export types that correspond to the return type of the raw RPC methods.
*/
export const parseTransaction = (txn: any): Transaction => ({
  hash: txn.hash,
  nonce: hexStringToDecimal(txn.nonce),

  from: txn.from,
  to: txn.to, // Null if contract creation
  value: txn.value, // BigNumber
  input: txn.input,

  gas: txn.gas, // BigNumber
  gasPrice: txn.gasPrice, // BigNumber
  maxFeePerGas: txn.maxFeePerGas, // BigNumber
  maxPriorityFeePerGas: txn.maxPriorityFeePerGas, // BigNumber

  blockHash: txn.blockHash,
  blockNumber: hexStringToDecimal(txn.blockNumber),
  transactionIndex: hexStringToDecimal(txn.transactionIndex),
  chainId: hexStringToDecimal(txn.chainId),
});

/*
  Sample log from `eth_getLogs` response from Alchemy:
  {
    address: '0x7183209867489e1047f3a7c23ea1aed9c4e236e8',
    blockHash: '0xcdc051ef712017ec5e01c446f665c188e9435cead71136404a2345d4a8fbe69d',
    blockNumber: '0xf0a28a',
    data: '0x0000000000000000000000000000000000000000000000000000000000000001',
    logIndex: '0x12c',
    removed: false,
    topics: [
      '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
      '0x00000000000000000000000004f5019071595f797ff54da28d140f14562c2427',
      '0x0000000000000000000000001e0049783f008a0085193e00003d00cd54003c71'
    ],
    transactionHash: '0x21dc115adfcbd2be254bbf5731270d696f3dff9a74409d5828e37cc8ab029751',
    transactionIndex: '0x93'
  }

  The argument is typed as any here for convenience, because ethers does not
  seem to export types that correspond to the return type of the raw RPC methods.
*/

export const parseLog = (log: any): Log => {
  const topics = log.topics as (string | undefined)[];

  return {
    logId: `${log.blockHash}-${log.logIndex}`,
    logSortKey:
      hexStringToDecimal(log.blockNumber) * 100000 +
      hexStringToDecimal(log.logIndex),

    address: log.address,
    data: log.data,
    topic0: topics[0],
    topic1: topics[1],
    topic2: topics[2],
    topic3: topics[3],

    blockHash: log.blockHash,
    blockNumber: hexStringToDecimal(log.blockNumber),
    logIndex: hexStringToDecimal(log.logIndex),

    transactionHash: log.transactionHash,
    transactionIndex: hexStringToDecimal(log.transactionIndex),

    removed: log.removed === true ? 1 : 0,
  };
};
