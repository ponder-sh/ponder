import { readFile } from "node:fs/promises";

import { GraphCompatPonderConfig } from "../compat-ts/readSubgraphYaml";
import { CONFIG } from "../config";
import { logger } from "../utils/logger";

type Handler = (event: unknown) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler };
type GraphHandlers = { [sourceName: string]: SourceHandlers | undefined };

class BigDecimal {
  digits: any;

  constructor(...args: any) {
    console.log(`Constructing BigDecimal with args:`, ...args);
  }
}

const defaultHandler =
  (name: string) =>
  (...args: any) => {
    console.log(name, ...args);
  };

const importObject = {
  env: {
    abort: (
      message: unknown,
      filename: unknown,
      line: unknown,
      column: unknown
    ) => {
      throw new Error(`${message} in ${filename} at ${line}:${column}`);
    },
  },
  index: {
    ["store.get"]: defaultHandler("store.get"),
    ["store.set"]: defaultHandler("store.set"),
  },
  conversion: {
    ["typeConversion.bytesToString"]: defaultHandler(
      "typeConversion.bytesToString"
    ),
    ["typeConversion.bytesToHex"]: defaultHandler("typeConversion.bytesToHex"),
    ["typeConversion.bigIntToString"]: defaultHandler(
      "typeConversion.bigIntToString"
    ),
    ["typeConversion.bigIntToHex"]: defaultHandler(
      "typeConversion.bigIntToHex"
    ),
    ["typeConversion.stringToH160"]: defaultHandler(
      "typeConversion.stringToH160"
    ),
    ["typeConversion.bytesToBase58"]: defaultHandler(
      "typeConversion.bytesToBase58"
    ),
  },
  ethereum: {
    ["ethereum.call"]: defaultHandler("ethereum.call"),
    ["ethereum.SmartContract"]: defaultHandler("ethereum.SmartContract"),
  },
  numbers: {
    ["bigInt.plus"]: (x: bigint, y: bigint) => x + y,
    ["bigInt.minus"]: (x: bigint, y: bigint) => x - y,
    ["bigInt.times"]: (x: bigint, y: bigint) => x * y,
    ["bigInt.dividedBy"]: (x: bigint, y: bigint) => x / y,
    ["bigInt.dividedByDecimal"]: (x: bigint, y: BigDecimal) =>
      new BigDecimal(x / y.digits),
    ["bigInt.mod"]: (x: bigint, y: bigint) => x % y,
    ["bigInt.pow"]: (x: bigint, exp: number) => x ** global.BigInt(exp),
    ["bigInt.fromString"]: (s: string) => global.BigInt(s),
    ["bigInt.bitOr"]: (x: bigint, y: bigint) => x | y,
    ["bigInt.bitAnd"]: (x: bigint, y: bigint) => x & y,
    ["bigInt.leftShift"]: (x: bigint, bits: number) => x << global.BigInt(bits),
    ["bigInt.rightShift"]: (x: bigint, bits: number) =>
      x >> global.BigInt(bits),

    ["bigDecimal.plus"]: (x: BigDecimal, y: BigDecimal) =>
      new BigDecimal(x.digits + y.digits),
    ["bigDecimal.minus"]: (x: BigDecimal, y: BigDecimal) =>
      new BigDecimal(x.digits - y.digits),
    ["bigDecimal.times"]: (x: BigDecimal, y: BigDecimal) =>
      new BigDecimal(x.digits * y.digits),
    ["bigDecimal.dividedBy"]: (x: BigDecimal, y: BigDecimal) =>
      new BigDecimal(x.digits / y.digits),
    ["bigDecimal.equals"]: (x: BigDecimal, y: BigDecimal) =>
      x.digits == y.digits,
    ["bigDecimal.toString"]: (_bigDecimal: BigDecimal) =>
      _bigDecimal.digits.toString(),
    ["bigDecimal.fromString"]: (s: string) => new BigDecimal(global.BigInt(s)),
  },
};

const readMappings = async (
  graphCompatPonderConfig: GraphCompatPonderConfig
) => {
  const graphHandlers: GraphHandlers = {};

  for (const source of graphCompatPonderConfig.sources) {
    // TODO: convert to WebAssembly.instantiateStreaming.
    const wasm = await readFile(source.wasmFilePath);
    const instance = await WebAssembly.instantiate(wasm, importObject);
    const handlerFunctions = instance.instance.exports;

    console.log({ exports: instance.instance.exports });

    const sourceHandlers: SourceHandlers = {};

    for (const eventHandler of source.eventHandlers) {
      const handler = <Handler | undefined>(
        handlerFunctions[eventHandler.handler]
      );
      if (handler) {
        sourceHandlers[eventHandler.event] = handler;
      } else {
        logger.info(`Handler not found: ${eventHandler.handler}`);
      }
    }

    graphHandlers[source.name] = sourceHandlers;
  }

  console.log({ graphHandlers });

  return graphHandlers;
};

export { readMappings };
export type { GraphHandlers };
