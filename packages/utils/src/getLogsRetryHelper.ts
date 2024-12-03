import {
  type Address,
  type Hex,
  type LogTopic,
  type RpcError,
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
      /** `true` if the error message suggested to use this range on retry. */
      isSuggestedRange: boolean;
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
      isSuggestedRange: true,
    } as const;
  }

  // infura, thirdweb, zksync
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
      isSuggestedRange: true,
    } as const;
  }

  // ankr
  match = sError.match("block range is too wide");
  if (match !== null && error.code === -32600) {
    const ranges = chunk({ params, range: 3000n });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
      isSuggestedRange: true,
    } as const;
  }

  // alchemy
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
      isSuggestedRange: true,
    } as const;
  }

  // quicknode, 1rpc, blast
  match = sError.match(/limited to a ([\d,.]+)/);
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
      isSuggestedRange: true,
    } as const;
  }

  // blockpi
  match = sError.match(/limited to ([\d,.]+) block/);
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
      isSuggestedRange: true,
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
      isSuggestedRange: false,
    } as const;
  }

  // zkevm
  match = sError.match(/query returned more than \d+ results/);
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
      isSuggestedRange: false,
    } as const;
  }

  // llamarpc
  match = sError.match(/query exceeds max results/);
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
      isSuggestedRange: false,
    } as const;
  }

  // optimism
  match = sError.match(/backend response too large/);
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
      isSuggestedRange: false,
    } as const;
  }

  // optimism (new as of 11/25/24)
  match = sError.match(/Block range is too large/);
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
      isSuggestedRange: false,
    } as const;
  }

  // base
  match = sError.match(/block range too large/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: 2_000n,
    });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
      isSuggestedRange: true,
    } as const;
  }

  // arbitrum
  match = sError.match(/logs matched by query exceeds limit of 10000/);
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
      isSuggestedRange: false,
    } as const;
  }

  // blast (paid)
  match = sError.match(
    /exceeds the range allowed for your plan \(\d+ > (\d+)\)/,
  );
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]!) });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
      isSuggestedRange: true,
    } as const;
  }

  // chainstack
  match = sError.match(/Block range limit exceeded./);
  if (match !== null) {
    const prevRange =
      hexToBigInt(params[0].toBlock) - hexToBigInt(params[0].fromBlock);

    // chainstack has different limits for free and paid plans.
    const ranges =
      prevRange < 10_000n
        ? chunk({ params, range: 100n })
        : chunk({ params, range: 10_000n });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
      isSuggestedRange: true,
    } as const;
  }

  // coinbase
  match = sError.match(/please limit the query to at most ([\d,.]+) blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")) - 1n,
    });

    if (isRangeUnchanged(params, ranges)) {
      return { shouldRetry: false } as const;
    }

    return {
      shouldRetry: true,
      ranges,
      isSuggestedRange: true,
    } as const;
  }

  // publicnode
  match = sError.match(/maximum block range: ([\d,.]+)/);
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
      isSuggestedRange: true,
    } as const;
  }

  // hyperliquid
  match = sError.match(/query exceeds max block range ([\d,.]+)/);
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
      isSuggestedRange: true,
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
