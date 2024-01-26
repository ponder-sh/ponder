import { getChunks } from "@/utils/interval.js";
import {
  type Hex,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  type RpcError,
  hexToNumber,
  toHex,
} from "viem";

export type LogFilterError = Partial<RpcError> & { name: string };

export type RetryRanges = [Hex, Hex][];

/**
 * Returns the appropriate retry ranges given the emitted error.
 * Throws error when the error argument is unrecognized.
 */
export const getLogFilterRetryRanges = (
  error: LogFilterError,
  fromBlock: Hex,
  toBlock: Hex,
): RetryRanges => {
  const retryRanges: RetryRanges = [];
  if (
    // Alchemy response size error.
    error.code === InvalidParamsRpcError.code &&
    error.details!.startsWith("Log response size exceeded.")
  ) {
    const safe = error.details!.split("this block range should work: ")[1];
    const safeStart = Number(safe.split(", ")[0].slice(1));
    const safeEnd = Number(safe.split(", ")[1].slice(0, -1));

    retryRanges.push([toHex(safeStart), toHex(safeEnd)]);
    retryRanges.push([toHex(safeEnd + 1), toBlock]);
  } else if (
    // Another Alchemy response size error.
    error.details?.includes("Response size is larger than 150MB limit")
  ) {
    // No hint available, split into 10 equal ranges.
    const from = hexToNumber(fromBlock);
    const to = hexToNumber(toBlock);
    const chunks = getChunks({
      intervals: [[from, to]],
      maxChunkSize: Math.round((to - from) / 10),
    });
    retryRanges.push(
      ...chunks.map(([f, t]) => [toHex(f), toHex(t)] as RetryRanges[number]),
    );
  } else if (
    // Infura block range limit error.
    error.code === LimitExceededRpcError.code &&
    error.details!.includes("query returned more than 10000 results")
  ) {
    const safe = error.details!.split("Try with this block range ")[1];
    const safeStart = Number(safe.split(", ")[0].slice(1));
    const safeEnd = Number(safe.split(", ")[1].slice(0, -2));

    retryRanges.push([toHex(safeStart), toHex(safeEnd)]);
    retryRanges.push([toHex(safeEnd + 1), toBlock]);
  } else if (
    // Thirdweb block range limit error.
    error.code === InvalidParamsRpcError.code &&
    error.details!.includes("block range less than 20000")
  ) {
    const midpoint = Math.floor(
      (Number(toBlock) - Number(fromBlock)) / 2 + Number(fromBlock),
    );

    retryRanges.push([toHex(fromBlock), toHex(midpoint)]);
    retryRanges.push([toHex(midpoint + 1), toBlock]);
  } else if (
    // Quicknode block range limit error (should never happen).
    error.name === "HttpRequestError" &&
    error.details!.includes(
      "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range",
    )
  ) {
    const midpoint = Math.floor(
      (Number(toBlock) - Number(fromBlock)) / 2 + Number(fromBlock),
    );
    retryRanges.push([fromBlock, toHex(midpoint)]);
    retryRanges.push([toHex(midpoint + 1), toBlock]);
  } else {
    // Throw any unrecognized errors.
    throw error;
  }

  return retryRanges;
};
