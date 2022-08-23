import type { LogDescription } from "@ethersproject/abi";
import type { Log } from "@ethersproject/providers";
import graph, { Address, BigInt, ByteArray } from "@ponder/graph-ts-ponder";

const buildEvent = (
  log: Log,
  parsedLog: LogDescription
): graph.ethereum.Event => {
  console.log({ log, parsedLog });

  const address = Address.fromString(log.address);

  console.log({ address });

  const logIndex = BigInt.fromByteArray(ByteArray.fromHexString(log.logIndex));
  const transactionLogIndex = BigInt.fromByteArray(
    ByteArray.fromHexString(log.transactionIndex)
  );
  const logType = null;
  const block = null;
  const transaction = null;
  const parameters = null;
  const receipt = null;

  console.log({
    address,
    logIndex,
    transactionLogIndex,
  });

  return new graph.ethereum.Event(
    address,
    logIndex,
    transactionLogIndex,
    logType,
    block,
    transaction,
    parameters,
    receipt

    // public address: Address,
    // public logIndex: bigint,
    // public transactionLogIndex: bigint,
    // public logType: string | null,
    // public block: Block,
    // public transaction: Transaction,
    // public parameters: Array<EventParam>,
    // public receipt: TransactionReceipt | null,
  );
};

export { buildEvent };
