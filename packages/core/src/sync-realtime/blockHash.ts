import { type Hex, keccak256, numberToHex, toRlp } from "viem";
import type { SyncBlock, SyncBlockHeader } from "@/internal/types.js";

type HeaderField = readonly [key: string, kind: "bytes" | "quantity"];

/** Header fields present since genesis, in RLP order. */
const BASE_FIELDS: readonly HeaderField[] = [
  ["parentHash", "bytes"],
  ["sha3Uncles", "bytes"],
  ["miner", "bytes"],
  ["stateRoot", "bytes"],
  ["transactionsRoot", "bytes"],
  ["receiptsRoot", "bytes"],
  ["logsBloom", "bytes"],
  ["difficulty", "quantity"],
  ["number", "quantity"],
  ["gasLimit", "quantity"],
  ["gasUsed", "quantity"],
  ["timestamp", "quantity"],
  ["extraData", "bytes"],
  ["mixHash", "bytes"],
  ["nonce", "bytes"],
];

/**
 * Header fields added by hard forks (London through Prague), in RLP order.
 * A header carries a prefix of this list. Berachain appends `parentProposerPubkey`.
 */
const FORK_FIELDS: readonly HeaderField[] = [
  ["baseFeePerGas", "quantity"],
  ["withdrawalsRoot", "bytes"],
  ["blobGasUsed", "quantity"],
  ["excessBlobGas", "quantity"],
  ["parentBeaconBlockRoot", "bytes"],
  ["requestsHash", "bytes"],
  ["parentProposerPubkey", "bytes"],
];

const encode = (value: Hex, kind: HeaderField[1]): Hex =>
  kind === "bytes"
    ? value
    : BigInt(value) === 0n
      ? "0x"
      : numberToHex(BigInt(value));

/**
 * Return `true` if `block.hash` is the keccak256 of the RLP-encoded header,
 * which proves every header field, including `logsBloom`, came from the chain.
 * Returns `false` for a header layout this encoding does not cover, such as an
 * L2 or chain fork with its own header fields, or a wrong field from the RPC.
 */
export const isBlockHashValid = (
  block: SyncBlock | SyncBlockHeader,
): boolean => {
  const header = block as unknown as Record<string, unknown>;

  const fields: Hex[] = [];
  for (const [key, kind] of BASE_FIELDS) {
    const value = header[key];
    if (typeof value !== "string") return false;
    fields.push(encode(value as Hex, kind));
  }
  for (const [key, kind] of FORK_FIELDS) {
    const value = header[key];
    if (typeof value !== "string") break;
    fields.push(encode(value as Hex, kind));
  }

  return keccak256(toRlp(fields)) === block.hash;
};
