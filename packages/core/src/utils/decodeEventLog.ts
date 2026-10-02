import {
  type AbiEvent,
  type AbiParameter,
  type DecodeAbiParametersReturnType,
  DecodeLogDataMismatch,
  DecodeLogTopicsMismatch,
  type Hex,
} from "viem";
import {
  decodeAbiParameter,
  decodeAbiParameters,
} from "./decodeAbiParameters.js";
import { toLowerCase } from "./lowercase.js";

type DecodeEventLogInputs = {
  isUnnamed: boolean;
  indexedInputs: (readonly [AbiParameter, number])[];
  nonIndexedInputs: AbiParameter[];
};

/** Inputs of each `abiItem`, so that they aren't recomputed for every log. */
const inputsCache = new WeakMap<AbiEvent, DecodeEventLogInputs>();

const getInputs = (abiItem: AbiEvent): DecodeEventLogInputs => {
  let result = inputsCache.get(abiItem);
  if (result === undefined) {
    const { inputs } = abiItem;
    result = {
      isUnnamed: inputs?.some((x) => !("name" in x && x.name)),
      indexedInputs: inputs
        .map((x, i) => [x, i] as const)
        .filter(([x]) => "indexed" in x && x.indexed),
      nonIndexedInputs: inputs.filter((x) => !("indexed" in x && x.indexed)),
    };
    inputsCache.set(abiItem, result);
  }
  return result;
};

/**
 * Decode an event log.
 *
 * @see https://github.com/wevm/viem/blob/main/src/utils/abi/decodeEventLog.ts#L99
 */
export function decodeEventLog({
  abiItem,
  topics,
  data,
}: {
  abiItem: AbiEvent;
  topics: [signature: Hex, ...args: Hex[]] | [];
  data: Hex;
}): any {
  const { inputs } = abiItem;
  const { isUnnamed, indexedInputs, nonIndexedInputs } = getInputs(abiItem);

  const args: any = isUnnamed ? [] : {};

  // Decode topics (indexed args).
  for (let i = 0; i < indexedInputs.length; i++) {
    const [param, argIndex] = indexedInputs[i]!;
    const topic = topics[i + 1];

    if (!topic) {
      throw new DecodeLogTopicsMismatch({
        abiItem,
        param: param as AbiParameter & { indexed: boolean },
      });
    }
    args[isUnnamed ? argIndex : param.name || argIndex] = decodeTopic({
      param,
      value: topic,
    });
  }

  // Decode data (non-indexed args).
  if (nonIndexedInputs.length > 0) {
    if (data && data !== "0x") {
      const out = [] as DecodeAbiParametersReturnType<typeof nonIndexedInputs>;
      decodeAbiParameters(nonIndexedInputs, data, {
        out,
        formatAddress: toLowerCase,
      });
      if (out) {
        if (isUnnamed) {
          for (let i = 0; i < inputs.length; i++) {
            args[i] = args[i] ?? out.shift();
          }
        } else {
          for (let i = 0; i < nonIndexedInputs.length; i++) {
            args[nonIndexedInputs[i]!.name!] = out[i];
          }
        }
        out.length = 0;
      }
    } else {
      throw new DecodeLogDataMismatch({
        abiItem,
        data: "0x",
        params: nonIndexedInputs,
        size: 0,
      });
    }
  }

  // Note: Every input sets a value in `args`.
  return inputs.length > 0 ? args : undefined;
}

const ARRAY_REGEX = /^(.*)\[(\d+)?\]$/;

function decodeTopic({ param, value }: { param: AbiParameter; value: Hex }) {
  if (
    param.type === "string" ||
    param.type === "bytes" ||
    param.type === "tuple" ||
    param.type.match(ARRAY_REGEX)
  ) {
    return value;
  }
  return decodeAbiParameter(param, value, { formatAddress: toLowerCase });
}
