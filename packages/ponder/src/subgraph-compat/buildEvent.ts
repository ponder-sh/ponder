import type { LogDescription } from "@ethersproject/abi";
import type { Log } from "@ethersproject/providers";
import { Address, ethereum } from "@ponder/graph-ts-ponder";

const buildEvent = (log: Log, parsedLog: LogDescription) => {
  const address = Address.fromHexString(log.address);
  const logIndex = BigInt(log.logIndex);
  const transactionLogIndex = BigInt(log.transactionIndex);
  const logType = null;
  const block: ethereum.Block = null!;
  const transaction: ethereum.Transaction = null!;
  const receipt: ethereum.TransactionReceipt = null!;

  // First construct the `parameters` array.
  const parameters = parsedLog.eventFragment.inputs.map(
    ({ name, type, baseType }) => {
      const rawValue = parsedLog.args[name];
      if (!rawValue) {
        throw new Error(`Value not found for event argument: ${name}`);
      }

      // `type` is the fully qualified type (e.g. "address", "tuple(address)", "uint256[3][]"
      // `baseType` is different only if `type` is complex (e.g. "address", "tuple", "array")
      console.log({ name, type, baseType, rawValue });

      let value: ethereum.Value;
      switch (baseType) {
        case "address": {
          value = new ethereum.Value(
            ethereum.ValueKind.ADDRESS,
            Address.fromHexString(rawValue)
          );
          break;
        }
        default: {
          throw new Error(`Unhandled event type: ${type}`);
        }
      }

      return new ethereum.EventParam(name, value);
    }
  );

  // Build the base Event.
  const event = new ethereum.Event(
    address,
    logIndex,
    transactionLogIndex,
    logType,
    block,
    transaction,
    parameters,
    receipt
  );

  // Now, tack on the `params` field.
  const params = parameters.reduce((acc, parameter) => {
    acc[parameter.name] = parameter.value.data;
    return acc;
  }, {} as Record<string, any>);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  event.params = params;

  return event;
};

export { buildEvent };
