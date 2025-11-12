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
      /** `true` if the error message suggested to use this range on retry. */
      isSuggestedRange: boolean;
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

  // avalanche
  match = sError.match(
    /requested too many blocks from (\d+) to (\d+), maximum is set to (\d+)/,
  );
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[3]!) - 1n });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // Cloudflare
  match = sError.match(/Max range: (\d+)/);
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]!) - 1n });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // thirdweb
  match = sError.match(/Maximum allowed number of requested blocks is ([\d]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // infura, zksync
  match = sError.match(
    /Try with this block range \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/,
  )!;
  if (match !== null) {
    const start = hexToBigInt(`0x${match[1]}`);
    const end = hexToBigInt(`0x${match[2]}`);
    const range = end - start;

    const ranges = chunk({ params, range });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // ankr
  match = sError.match("block range is too wide");
  if (match !== null && error.code === -32600) {
    const ranges = chunk({ params, range: 3000n });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
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

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // quicknode, 1rpc, blast
  match = sError.match(/limited to a ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // blockpi
  match = sError.match(/limited to ([\d,.]+) block/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // blast (paid)
  match = sError.match(
    /exceeds the range allowed for your plan \(\d+ > (\d+)\)/,
  );
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]!) });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
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

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // coinbase
  match = sError.match(/please limit the query to at most ([\d,.]+) blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")) - 1n,
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // publicnode
  match = sError.match(/maximum block range: ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // hyperliquid
  match = sError.match(/query exceeds max block range ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // swell
  match = sError.match(/block range greater than ([\d,.]+) max/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // somnia
  match = sError.match(/block range exceeds ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // merkle 10k
  match = sError.match(/eth_getLogs range is too large, max is 10k blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: 10_000n,
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // merkle 1k
  match = sError.match(/eth_getLogs range is too large, max is 1k blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: 1_000n,
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // harmony
  match = sError.match(/query must be smaller than size ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // moonriver
  match = sError.match(/block range is too wide \(maximum (\d+)\)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // aurora
  match = sError.match(/up to a ([\d,.]+) block range/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!.replace(/[,.]/g, "")),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // ankr (tac)
  match = sError.match(/maximum \[from, to\] blocks distance: (\d+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1]!),
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      } as const;
    }
  }

  // tron
  match = sError.match(/exceed max block range: (\d+)/);
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]!) - 1n });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true,
      };
    }
  }

  // catch-all
  if (
    // valtitude
    sError.includes("allowed block range threshold exceeded") ||
    // erpc
    sError.includes("exceeded max allowed") ||
    // erpc
    sError.includes("range threshold exceeded") ||
    // base
    sError.includes("no backend is currently healthy to serve traffic") ||
    // base, monad
    sError.includes("block range too large") ||
    // optimism
    sError.includes("Block range is too large") ||
    // optimism
    sError.includes("backend response too large") ||
    // llamarpc, ankr, altitude
    sError.includes("query exceeds max results") ||
    // arbitrum
    /logs matched by query exceeds limit of \d+/.test(sError) ||
    // zkevm
    /query returned more than \d+ results/.test(sError) ||
    // 1rpc
    /response size should not greater than \d+ bytes/.test(sError)
  ) {
    const ranges = chunk({
      params,
      range:
        (hexToBigInt(params[0].toBlock) - hexToBigInt(params[0].fromBlock)) /
        2n,
    });

    if (isRangeUnchanged(params, ranges) === false) {
      return {
        ranges,
        shouldRetry: true,
        isSuggestedRange: false,
      } as const;
    }
  }

  // No match found
  return { shouldRetry: false } as const;
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
