import {
  type Address,
  type Hex,
  type LogTopic,
  RpcError,
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
  const sError = JSON.stringify(error);
  let match: RegExpMatchArray | null;

  // Cloudflare
  match = sError.match(/Max range: (\d+)/);
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]!) - 1n });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Infura, Thirdweb, zkSync
  match = sError.match(
    /Try with this block range \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/,
  )!;
  if (match !== null) {
    const start = hexToBigInt(`0x${match[1]}`);
    const end = hexToBigInt(`0x${match[2]}`);
    const range = end - start;

    const ranges = chunk({ params, range });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Thirdweb
  match = sError.match(/bigger than range limit (\d+)/);
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]!) });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Ankr
  match = sError.match("block range is too wide");
  if (match !== null && error.code === -32600) {
    const ranges = chunk({ params, range: 3000n });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Alchemy
  match = sError.match(
    /this block range should work: \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/,
  );
  if (match !== null) {
    const start = hexToBigInt(`0x${match[1]}`);
    const end = hexToBigInt(`0x${match[2]}`);
    const range = end - start;

    const ranges = chunk({ params, range });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // Quicknode, 1rpc
  match = sError.match(/eth_getLogs is limited to a ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // 1rpc
  match = sError.match(/response size should not greater than \d+ bytes/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range:
        (hexToBigInt(params[0].toBlock) - hexToBigInt(params[0].fromBlock)) /
        2n,
    });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
    } as const;
  }

  // No match found
  return {
    shouldRetry: false,
  } as const;
};

const isRangeUnchanged = (
  params: GetLogsRetryHelperParameters["params"],
  ranges: Extract<
    GetLogsRetryHelperReturnType,
    { shouldRetry: true }
  >["ranges"],
) => {
  return (
    ranges.length === 0 ||
    (ranges.length === 1 &&
      ranges[0]!.fromBlock === params[0].fromBlock &&
      ranges[0]!.toBlock === params[0].toBlock)
  );
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
