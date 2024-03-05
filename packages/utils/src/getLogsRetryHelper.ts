import {
  type Address,
  type Hex,
  HttpRequestError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  type LogTopic,
  RpcError,
  RpcRequestError,
  hexToBigInt,
  numberToHex,
} from "viem";

export type GetLogsRetryHelperParameters = {
  error: RpcError;
  params: [
    {
      address?: Address | Address[];
      topics?: LogTopic[];
      fromBlock: Hex;
      toBlock: Hex;
    },
  ];
};

export type GetLogsRetryHelperReturnType =
  | {
      shouldRetry: true;
      /** Suggested values to use for (fromBlock, toBlock) in follow-up eth_getLogs requests. */
      ranges: { fromBlock: Hex; toBlock: Hex }[];
    }
  | {
      shouldRetry: false;
      /** Suggested values to use for (fromBlock, toBlock) in follow-up eth_getLogs requests. */
      ranges?: never;
    };

export const getLogsRetryHelper = ({
  params,
  error,
}: GetLogsRetryHelperParameters): GetLogsRetryHelperReturnType => {
  // Cloudflare
  if (
    error instanceof RpcRequestError &&
    error.code === -32047 &&
    error.details.includes(
      "Invalid eth_getLogs request. 'fromBlock'-'toBlock' range too large. Max range: 800",
    )
  ) {
    const ranges = chunk({ params, range: 799n });

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Ankr
  if (
    error instanceof RpcError &&
    error.code === -32600 &&
    error.details.startsWith("block range is too wide")
  ) {
    const ranges = chunk({ params, range: 3000n });

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Alchemy
  if (
    error.code === InvalidParamsRpcError.code &&
    error.details.startsWith("Log response size exceeded.")
  ) {
    const match = error.details.match(
      /this block range should work: \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/,
    )!;

    if (match.length === 3) {
      const start = hexToBigInt(`0x${match[1]}`);
      const end = hexToBigInt(`0x${match[2]}`);
      const range = end - start;

      const ranges = chunk({ params, range });

      return {
        shouldRetry: true,
        ranges,
      } as const;
    }
  }

  // Quicknode
  if (
    error instanceof HttpRequestError &&
    JSON.parse(error.details).code === -32614 &&
    JSON.parse(error.details).message.includes(
      "eth_getLogs is limited to a 10,000 range",
    )
  ) {
    const ranges = chunk({ params, range: 10000n });

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Infura
  if (
    error instanceof LimitExceededRpcError &&
    error.code === -32005 &&
    (error.cause as any)?.cause.message.includes(
      "query returned more than 10000 results. Try with this block range",
    )
  ) {
    // @ts-ignore
    const match = error.cause.cause.message.match(
      /Try with this block range \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/,
    )!;

    if (match.length === 3) {
      const start = hexToBigInt(`0x${match[1]}`);
      const end = hexToBigInt(`0x${match[2]}`);
      const range = end - start;

      const ranges = chunk({ params, range });

      return {
        shouldRetry: true,
        ranges,
      } as const;
    }
  }

  // Thirdweb
  /**
   * "code": -32602,
   * "message": "invalid params",
   * "data": "range 20000 is bigger than range limit 2000"
   *
   * "code": -32602,
   * "message": "invalid params",
   * "data": "Query returned more than 10000 results. Try with this block range [0x800000, 0x800054]."
   */

  if (
    error instanceof InvalidParamsRpcError &&
    error.code === -32602 &&
    // @ts-ignore
    error.cause.cause.data.includes("is bigger than range limit 2000")
  ) {
    const ranges = chunk({ params, range: 2000n });

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  if (
    error instanceof InvalidParamsRpcError &&
    error.code === -32602 &&
    // @ts-ignore
    error.cause.cause.data.includes("Query returned more than 10000 results")
  ) {
    // @ts-ignore
    const match = error.cause.cause.data.match(
      /Try with this block range \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/,
    )!;

    if (match.length === 3) {
      const start = hexToBigInt(`0x${match[1]}`);
      const end = hexToBigInt(`0x${match[2]}`);
      const range = end - start;

      const ranges = chunk({ params, range });

      return {
        shouldRetry: true,
        ranges,
      } as const;
    }
  }

  // No match found
  return {
    shouldRetry: false,
  };
};

const chunk = ({
  params,
  range,
}: { params: GetLogsRetryHelperParameters["params"]; range: bigint }) => {
  const ranges: { fromBlock: Hex; toBlock: Hex }[] = [];

  const fromBlock = hexToBigInt(params[0].fromBlock);
  const toBlock = hexToBigInt(params[0].toBlock);

  for (let start = fromBlock; start <= toBlock; start += range + 1n) {
    const end = start + range > toBlock ? toBlock : start + range;

    ranges.push({
      fromBlock: numberToHex(start),
      toBlock: numberToHex(end),
    });
  }

  return ranges;
};
