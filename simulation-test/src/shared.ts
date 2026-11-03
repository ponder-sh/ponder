/**
 * Shared between the simulated chains and the generated apps: the ABIs of the
 * simulated contracts, and the deterministic contract state that `eth_call`
 * and the other state methods return.
 *
 * @dev Imported by the generated indexing functions, so it only depends on
 * `viem`.
 */
import {
  type Address,
  encodePacked,
  type Hex,
  hexToBigInt,
  keccak256,
  parseAbi,
  toHex,
} from "viem";

export const tokenAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Memo(bytes32 indexed id, string text, uint256[] values, (address account, uint64 amount, bool flag) info, bytes data, int128 delta)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function memo(bytes32 id, string text) returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
]);

export const factoryAbi = parseAbi([
  "event PoolCreated(address indexed token0, address indexed token1, address pool, uint256 index)",
  "event Deployed(address indexed child, uint24 indexed salt)",
  "function createPool(address token0, address token1) returns (address)",
]);

export const poolAbi = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function swap(address recipient, int256 amount) payable returns (int256, int256)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);

export const multicall3Address =
  "0xca11bde05977b3631167028862be2a173976ca11" as const;

/** A deterministic address. */
export const simAddress = (label: string): Address =>
  `0x${keccak256(toHex(label)).slice(26)}` as Address;

/** Externally owned accounts, the same on every chain. */
export const EOAS = Array.from({ length: 8 }, (_, i) => simAddress(`eoa:${i}`));
export const DEAD = "0x000000000000000000000000000000000000dead" as const;

/** Deployed contracts of a chain. */
export const getTokens = (chainId: number) =>
  Array.from({ length: 3 }, (_, i) => simAddress(`token:${chainId}:${i}`));
export const getFactory = (chainId: number) => simAddress(`factory:${chainId}`);

/** The address of the pool that `createPool` deploys in transaction `transactionHash`. */
export const getPoolAddress = (transactionHash: Hex) =>
  simAddress(`pool:${transactionHash}`);

const word = (...parts: (string | number | bigint)[]) =>
  hexToBigInt(keccak256(toHex(parts.join(":"))));

/**
 * Contract state after the block `blockHash`. It depends on the hash, so a
 * reorg changes it.
 */
export const state = {
  balanceOf: (blockHash: Hex, token: Address, account: Address) =>
    word("balance", blockHash, token.toLowerCase(), account.toLowerCase()) %
    10n ** 24n,
  totalSupply: (blockHash: Hex, token: Address) =>
    word("supply", blockHash, token.toLowerCase()) % 10n ** 30n,
  name: (token: Address) => `Token ${token.slice(2, 8).toLowerCase()}`,
  getReserves: (
    blockHash: Hex,
    pool: Address,
    timestamp: bigint,
  ): readonly [bigint, bigint, number] => [
    word("reserve0", blockHash, pool.toLowerCase()) % 2n ** 112n,
    word("reserve1", blockHash, pool.toLowerCase()) % 2n ** 112n,
    Number(timestamp % 2n ** 32n),
  ],
  balance: (blockHash: Hex, account: Address) =>
    word("eth", blockHash, account.toLowerCase()) % 10n ** 22n,
  code: (isContract: boolean, address: Address): Hex =>
    isContract
      ? encodePacked(["bytes4", "address"], ["0x60806040", address])
      : "0x",
};
