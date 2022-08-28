import type { LogDescription } from "@ethersproject/abi";
import type { Log } from "@ethersproject/providers";

/// An Ethereum event logged from a specific contract address and block.
// #[derive(Debug)]
// pub struct EthereumEventData {
//     pub address: Address,
//     pub log_index: U256,
//     pub transaction_log_index: U256,
//     pub log_type: Option<String>,
//     pub block: EthereumBlockData,
//     pub transaction: EthereumTransactionData,
//     pub params: Vec<LogParam>,
// }

/// Ethereum transaction data.
// #[derive(Clone, Debug)]
// pub struct EthereumTransactionData {
//     pub hash: H256,
//     pub index: U128,
//     pub from: H160,
//     pub to: Option<H160>,
//     pub value: U256,
//     pub gas_limit: U256,
//     pub gas_price: U256,
//     pub input: Bytes,
//     pub nonce: U256,
// }

/// Ethereum block data.
// #[derive(Clone, Debug, Default)]
// pub struct EthereumBlockData {
//     pub hash: H256,
//     pub parent_hash: H256,
//     pub uncles_hash: H256,
//     pub author: H160,
//     pub state_root: H256,
//     pub transactions_root: H256,
//     pub receipts_root: H256,
//     pub number: U64,
//     pub gas_used: U256,
//     pub gas_limit: U256,
//     pub timestamp: U256,
//     pub difficulty: U256,
//     pub total_difficulty: U256,
//     pub size: Option<U256>,
//     pub base_fee_per_gas: Option<U256>,
// }

// pub struct LogParam {
//   pub name: String,
//   pub value: Token,
// }

// pub enum Token {
//   Address(Address),
//   FixedBytes(Bytes),
//   Bytes(Bytes),
//   Int(Int),
//   Uint(Uint),
//   Bool(bool),
//   String(String),
//   FixedArray(Vec<Token>),
//   Array(Vec<Token>),
//   Tuple(Vec<Token>),
// }

// pub type Address = H160 = H160(pub [u8; 20])
// pub type Bytes = Vec<u8>

type EthereumEventData = {
  address: string;
  logIndex: bigint;
  transactionLogIndex: bigint;
  logType?: string;
  block: EthereumBlockData;
  transaction: EthereumTransactionData;
  params: EthereumLogParams;
};

type EthereumBlockData = any;
type EthereumTransactionData = any;

type EthereumLogParams = { [k: string]: any }; // & EthereumLogParam[];

type EthereumLogParam = {
  name: string;
  value: any; // NOTE: May need to do some conversions here to appease WASM.
};

const buildEvent = (log: Log, parsedLog: LogDescription): EthereumEventData => {
  const address = log.address;
  const logIndex = BigInt(log.logIndex);
  const transactionLogIndex = BigInt(log.transactionIndex);
  const logType = null!;
  const block: EthereumBlockData = null!;
  const transaction: EthereumTransactionData = null!;

  const params: EthereumLogParams = {};

  parsedLog.eventFragment.inputs.forEach(({ name, type, baseType }) => {
    const value = parsedLog.args[name];
    if (!value) {
      throw new Error(`Value not found for event argument: ${name}`);
    }

    // `type` is the fully qualified type (e.g. "address", "tuple(address)", "uint256[3][]"
    // `baseType` is different only if `type` is complex (e.g. "address", "tuple", "array")
    console.log({ name, type, baseType, value });

    params[name] = value;

    // params.push({
    //   name: name,
    //   value: value,
    // });
  });

  // Add index signature so we can add the params field.
  const event: EthereumEventData = {
    address,
    logIndex,
    transactionLogIndex,
    logType,
    block,
    transaction,
    params,
  };

  return event;
};

export { buildEvent };
