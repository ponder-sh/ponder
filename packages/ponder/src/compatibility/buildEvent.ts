import type { LogDescription, ParamType } from "@ethersproject/abi";
import type { Log } from "@ethersproject/providers";
import { Address, BigInt, ByteArray, ethereum } from "@ponder/graph-ts-ponder";

const buildEvent = (log: Log, parsedLog: LogDescription): ethereum.Event => {
  const address = Address.fromString(log.address);
  const logIndex = global.BigInt(log.logIndex);
  const transactionLogIndex = global.BigInt(log.transactionIndex);
  const logType = null;
  const block: ethereum.Block = null!;
  const transaction: ethereum.Transaction = null!;
  const receipt: ethereum.TransactionReceipt = null!;

  const paramsWithValues = parsedLog.eventFragment.inputs.map(
    ({ name, type }) => {
      const foundValue = Object.entries(parsedLog.args).find(
        ([argName]) => argName === name
      );
      if (!foundValue) {
        throw new Error(`Could not find value for argument: ${name}`);
      }

      return {
        name: name,
        type: type,
        value: foundValue[1],
      };
    }
  );
  const parameters = paramsWithValues.map(getGraphEventParam);

  // Add index signature so we can add the params field.
  const event: ethereum.Event & { [key: string]: any } = new ethereum.Event(
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

  const params: { [key: string]: any } = { _event: event };
  for (const parameter of parameters) {
    switch (parameter.value.kind) {
      case ethereum.ValueKind.ADDRESS: {
        params[parameter.name] = parameter.value.toAddress();
        break;
      }
      default: {
        throw new Error(
          `Unhandled ethereum.ValueKind: ${parameter.value.kind}`
        );
      }
    }
  }

  console.log({ params });

  event.params = params;

  console.log("returning event");

  return event;
};

const getGraphEventParam = (param: {
  name: string;
  type: string;
  value: any;
}): ethereum.EventParam => {
  let graphValue: ethereum.Value;

  console.log("attempting to get graph event param from value:", param.value);

  switch (param.type) {
    case "address": {
      graphValue = ethereum.Value.fromAddress(Address.fromString(param.value));
      break;
    }
    default: {
      throw new Error(`Unhandled param type: ${param.type}`);
    }
  }

  console.log("creating EventParam with value:", { value: graphValue });

  return new ethereum.EventParam(param.name, graphValue);
};

export { buildEvent };
