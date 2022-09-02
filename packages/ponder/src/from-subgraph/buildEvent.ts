import type { LogDescription } from "@ethersproject/abi";
import type { Log } from "@ethersproject/providers";

const buildEvent = (log: Log, parsedLog: LogDescription) => {
  // const block = new ethereum.Block(
  //   Bytes.fromHexString(log.blockHash), // public hash: Bytes,
  //   null!, // public parentHash: Bytes,
  //   null!, // public unclesHash: Bytes,
  //   null!, // public author: Address,
  //   null!, // public stateRoot: Bytes,
  //   null!, // public transactionsRoot: Bytes,
  //   null!, // public receiptsRoot: Bytes,
  //   BigInt.fromU32(123), // public number: bigint,
  //   null!, // public gasUsed: bigint,
  //   null!, // public gasLimit: bigint,
  //   BigInt.fromU32(123), // public timestamp: bigint,
  //   null!, // public difficulty: bigint,
  //   null!, // public totalDifficulty: bigint,
  //   null!, // public size: bigint | null,
  //   null! // public baseFeePerGas: bigint | null,
  // );
  // const transaction = new ethereum.Transaction(
  //   Bytes.fromHexString(log.transactionHash), // public hash: Bytes,
  //   BigInt.fromU32(123), // public index: bigint,
  //   Address.fromHexString(log.address), // public from: Address,
  //   Address.fromHexString(log.address), // public to: Address | null,
  //   null!, // public value: bigint,
  //   null!, // public gasLimit: bigint,
  //   null!, // public gasPrice: bigint,
  //   null!, // public input: Bytes,
  //   null! // public nonce: bigint,
  // );
  // const receipt: ethereum.TransactionReceipt = null!;
  // // First construct the `parameters` array.
  // const parameters = parsedLog.eventFragment.inputs.map(
  //   ({ name, type, baseType }) => {
  //     const rawValue = parsedLog.args[name];
  //     if (!rawValue) {
  //       throw new Error(`Value not found for event argument: ${name}`);
  //     }
  //     // `type` is the fully qualified type (e.g. "address", "tuple(address)", "uint256[3][]"
  //     // `baseType` is different only if `type` is complex (e.g. "address", "tuple", "array")
  //     // Here we are just stripping the byte length for `int` and `uint` types.
  //     const rootBaseType = baseType.replace(/\d+$/, "");
  //     let value: ethereum.Value;
  //     switch (rootBaseType) {
  //       case "address": {
  //         value = new ethereum.Value(
  //           ethereum.ValueKind.ADDRESS,
  //           Address.fromHexString(rawValue)
  //         );
  //         break;
  //       }
  //       case "uint": {
  //         value = new ethereum.Value(
  //           ethereum.ValueKind.UINT,
  //           BigInt.fromNativeBigInt(rawValue)
  //         );
  //         break;
  //       }
  //       default: {
  //         throw new Error(`Unhandled event type: ${type}`);
  //       }
  //     }
  //     return new ethereum.EventParam(name, value);
  //   }
  // );
  // // Build the base Event.
  // const event = new ethereum.Event(
  //   Address.fromHexString(log.address), // public address: Address
  //   BigInt.fromU32(log.logIndex), // public logIndex bigint
  //   BigInt.fromU32(log.transactionIndex), // public transactionLogIndex: bigint
  //   null, // public logType: string | null
  //   block,
  //   transaction,
  //   parameters,
  //   receipt
  // );
  // // Now, tack on the `params` field.
  // // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // // @ts-ignore
  // event.params = parameters.reduce((acc, parameter) => {
  //   acc[parameter.name] = parameter.value.data;
  //   return acc;
  // }, {} as Record<string, any>);
  // return event;
};

export { buildEvent };
