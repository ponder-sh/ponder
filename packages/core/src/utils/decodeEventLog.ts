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
  const isUnnamed = inputs?.some((x) => !("name" in x && x.name));

  const args: any = isUnnamed ? [] : {};

  // Decode topics (indexed args).
  const indexedInputs = inputs
    .map((x, i) => [x, i] as const)
    .filter(([x]) => "indexed" in x && x.indexed);
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
  const nonIndexedInputs = inputs.filter((x) => !("indexed" in x && x.indexed));
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

  return Object.values(args).length > 0 ? args : undefined;
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
