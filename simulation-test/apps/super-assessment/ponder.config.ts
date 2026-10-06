import { createConfig, factory } from "ponder";
import seedrandom from "seedrandom";
import { type Address, parseAbi, parseAbiItem, zeroAddress } from "viem";
import { EMPTY_FACTORY_ADDRESS } from "./constants";

// Note this is copied from index.ts to avoid circular dependency that vite
// cannot currently handle.
const pick = <T>(possibilities: T[] | readonly T[], tag: string): T => {
  return possibilities[
    Math.floor(possibilities.length * seedrandom(process.env.SEED + tag)())
  ]!;
};

const possibleMainnetBlocks = [
  {
    startBlock: 13_000_000, // Aug-10-2021 09:53:39 PM
    endBlock: 13_000_250,
  },
  {
    startBlock: 22_569_300, // May-26-2025 08:18:47 PM
    endBlock: 22_569_550,
  },
  {
    startBlock: 22_569_400, // May-26-2025 08:38:47 PM
    endBlock: 22_569_650,
  },
] as const;
const possibleOptimismBlocks = [
  {
    startBlock: 133_000_000, // Mar-10-2025 09:26:17 AM
    endBlock: 133_000_250,
  },
  {
    startBlock: 136_346_000, // May-26-2025 08:19:37 PM
    endBlock: 136_346_250,
  },
  {
    startBlock: 136_346_100, // May-26-2025 08:22:57 PM
    endBlock: 136_346_350,
  },
] as const;
const possibleBaseBlocks = [
  {
    startBlock: 10_500_000, // Feb-13-2024 01:55:47 AM
    endBlock: 10_500_250,
  },
  {
    startBlock: 30_750_700, // May-26-2025 08:19:07 PM
    endBlock: 30_750_950,
  },
  {
    startBlock: 30_750_800, // May-26-2025 08:22:27 PM
    endBlock: 30_751_050,
  },
] as const;

const possibleContractFilters = [
  {
    event: "Transfer",
    args: { from: zeroAddress },
  },
  {
    event: "Transfer",
    args: {
      to: [
        zeroAddress,
        "0x000000000000000000000000000000000000dead",
      ] as Address[],
    },
  },
  // No filter
  undefined,
  // More than one topic
  {
    event: "Transfer",
    args: {
      from: [zeroAddress, "0x000000000000000000000000000000000000dead"],
      to: [zeroAddress, "0x000000000000000000000000000000000000dead"],
    },
  },
] as const;

const pairCreated = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
);

/**
 * Returns a factory for `address` with one of several shapes. The children of each shape
 * are a subset of the children of the same factory in the config without `SEED`, so the
 * template database has all of their data.
 *
 * Note: The factory range must be inside the contract range.
 */
const pickFactory = (
  address: Address,
  blocks: { startBlock: number; endBlock: number },
  tag: string,
) =>
  pick(
    [
      factory({ address, event: pairCreated, parameter: "pair" }),
      // More than one parent
      factory({
        address: [address, EMPTY_FACTORY_ADDRESS],
        event: pairCreated,
        parameter: "pair",
      }),
      // Factory ends before the contract
      factory({
        address,
        event: pairCreated,
        parameter: "pair",
        endBlock: blocks.startBlock + 150,
      }),
      // More than one parent, factory ends before the contract
      factory({
        address: [EMPTY_FACTORY_ADDRESS, address],
        event: pairCreated,
        parameter: "pair",
        endBlock: blocks.startBlock + 200,
      }),
      // Child address location instead of parameter name
      factory({ address, event: pairCreated, location: "offset0" }),
    ],
    tag,
  );

type ChainName = "mainnet" | "base" | "optimism";

const possibleBlocks = {
  mainnet: possibleMainnetBlocks,
  base: possibleBaseBlocks,
  optimism: possibleOptimismBlocks,
} as const;

/** Addresses with data in the template database, for each chain. */
const addresses = {
  mainnet: {
    contract: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    account: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
    list: [
      "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
      "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
    ],
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  },
  base: {
    contract: "0x4200000000000000000000000000000000000006",
    account: "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
    list: [
      "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
      "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
    ],
    factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
  },
  optimism: {
    contract: "0x4200000000000000000000000000000000000006",
    account: "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
    list: [
      "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
      "0xFdb794692724153d1488CcdBE0C56c252596735F",
    ],
    factory: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
  },
} as const satisfies Record<
  ChainName,
  { contract: Address; account: Address; list: Address[]; factory: Address }
>;

const pickContract = (prefix: string, chain: ChainName) => {
  const blocks = pick(possibleBlocks[chain], `${prefix}_blocks_${chain}`);
  const filter = pick(possibleContractFilters, `${prefix}_filter_${chain}`);
  return {
    address: pick(
      [
        addresses[chain].contract,
        addresses[chain].list,
        pickFactory(
          addresses[chain].factory,
          blocks,
          `${prefix}_factory_${chain}`,
        ),
      ],
      `${prefix}_address_${chain}`,
    ),
    includeCallTraces: pick(
      [true, false],
      `${prefix}_includeCallTraces_${chain}`,
    ),
    includeTransactionReceipts: pick(
      [true, false],
      `${prefix}_includeTransactionReceipts_${chain}`,
    ),
    ...(filter ? { filter } : {}),
    ...blocks,
  };
};

const pickAccount = (prefix: string, chain: ChainName) => {
  const blocks = pick(possibleBlocks[chain], `${prefix}_blocks_${chain}`);
  return {
    address: pick(
      [
        addresses[chain].account,
        addresses[chain].list,
        pickFactory(
          addresses[chain].factory,
          blocks,
          `${prefix}_factory_${chain}`,
        ),
      ],
      `${prefix}_address_${chain}`,
    ),
    includeTransactionReceipts: pick(
      [true, false],
      `${prefix}_includeTransactionReceipts_${chain}`,
    ),
    ...blocks,
  };
};

const pickBlock = (prefix: string, chain: ChainName) => ({
  interval: pick([50, 88, 152], `${prefix}_interval_${chain}`),
  ...pick(possibleBlocks[chain], `${prefix}_blocks_${chain}`),
});

const abi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 amount) external returns (bool)",
]);

// Note: `d` and `b2` are second sources of the same kind. They can have the same
// addresses and blocks as `c` and `b`, with other options.

export default process.env.SEED
  ? createConfig({
      // @ts-expect-error
      ordering: process.env.ORDERING,
      database: {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
        poolConfig: { max: 17 },
      },
      chains: {
        mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
        optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
        base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
      },
      contracts: {
        c: {
          abi,
          chain: {
            mainnet: pickContract("contract", "mainnet"),
            base: pickContract("contract", "base"),
            optimism: pickContract("contract", "optimism"),
          },
        },
        d: {
          abi,
          chain: {
            mainnet: pickContract("contract_d", "mainnet"),
            base: pickContract("contract_d", "base"),
            optimism: pickContract("contract_d", "optimism"),
          },
        },
      },
      accounts: {
        a: {
          address: zeroAddress,
          chain: {
            mainnet: pickAccount("account", "mainnet"),
            base: pickAccount("account", "base"),
            optimism: pickAccount("account", "optimism"),
          },
        },
      },
      blocks: {
        b: {
          chain: {
            mainnet: pickBlock("block", "mainnet"),
            base: pickBlock("block", "base"),
            optimism: pickBlock("block", "optimism"),
          },
        },
        b2: {
          chain: {
            mainnet: pickBlock("block_b2", "mainnet"),
            base: pickBlock("block_b2", "base"),
            optimism: pickBlock("block_b2", "optimism"),
          },
        },
      },
    })
  : createConfig({
      ordering: "multichain",
      chains: {
        mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
        base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
        optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
      },
      contracts: {
        c1: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[0],
            },
            base: {
              address: "0x4200000000000000000000000000000000000006",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              address: "0x4200000000000000000000000000000000000006",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        c2: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[1],
            },
            base: {
              address: "0x4200000000000000000000000000000000000006",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              address: "0x4200000000000000000000000000000000000006",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        c3: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[2],
            },
            base: {
              address: "0x4200000000000000000000000000000000000006",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              address: "0x4200000000000000000000000000000000000006",
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[2],
            },
          },
        },
        c4: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: [
                "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[0],
            },
            base: {
              address: [
                "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              address: [
                "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                "0xFdb794692724153d1488CcdBE0C56c252596735F",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        c5: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: [
                "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[1],
            },
            base: {
              address: [
                "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              address: [
                "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                "0xFdb794692724153d1488CcdBE0C56c252596735F",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        c6: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: [
                "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[2],
            },
            base: {
              address: [
                "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              address: [
                "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                "0xFdb794692724153d1488CcdBE0C56c252596735F",
              ],
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[2],
            },
          },
        },
        c7: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: factory({
                address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[0],
            },
            base: {
              address: factory({
                address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              address: factory({
                address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        c8: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: factory({
                address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[1],
            },
            base: {
              address: factory({
                address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              address: factory({
                address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        c9: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: factory({
                address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[2],
            },
            base: {
              address: factory({
                address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              address: factory({
                address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeCallTraces: true,
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[2],
            },
          },
        },
      },
      accounts: {
        a1: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[0],
            },
            base: {
              address: "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              address: "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        a2: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[1],
            },
            base: {
              address: "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              address: "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        a3: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[2],
            },
            base: {
              address: "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              address: "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[2],
            },
          },
        },
        a4: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: [
                "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
              ],
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[0],
            },
            base: {
              address: [
                "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
              ],
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              address: [
                "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                "0xFdb794692724153d1488CcdBE0C56c252596735F",
              ],
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        a5: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: [
                "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
              ],
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[1],
            },
            base: {
              address: [
                "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
              ],
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              address: [
                "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                "0xFdb794692724153d1488CcdBE0C56c252596735F",
              ],
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        a6: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: [
                "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
              ],
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[2],
            },
            base: {
              address: [
                "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
              ],
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              address: [
                "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                "0xFdb794692724153d1488CcdBE0C56c252596735F",
              ],
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[2],
            },
          },
        },
        a7: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: factory({
                address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[0],
            },
            base: {
              address: factory({
                address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              address: factory({
                address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        a8: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: factory({
                address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[1],
            },
            base: {
              address: factory({
                address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              address: factory({
                address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        a9: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: factory({
                address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleMainnetBlocks[2],
            },
            base: {
              address: factory({
                address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              address: factory({
                address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                event: parseAbiItem(
                  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                ),
                parameter: "pair",
              }),
              includeTransactionReceipts: true,
              ...possibleOptimismBlocks[2],
            },
          },
        },
      },
      blocks: {
        b1: {
          chain: {
            mainnet: {
              interval: 50,
              ...possibleMainnetBlocks[0],
            },
            base: {
              interval: 50,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              interval: 50,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        b2: {
          chain: {
            mainnet: {
              interval: 50,
              ...possibleMainnetBlocks[1],
            },
            base: {
              interval: 50,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              interval: 50,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        b3: {
          chain: {
            mainnet: {
              interval: 50,
              ...possibleMainnetBlocks[2],
            },
            base: {
              interval: 50,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              interval: 50,
              ...possibleOptimismBlocks[2],
            },
          },
        },
        b4: {
          chain: {
            mainnet: {
              interval: 88,
              ...possibleMainnetBlocks[0],
            },
            base: {
              interval: 88,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              interval: 88,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        b5: {
          chain: {
            mainnet: {
              interval: 88,
              ...possibleMainnetBlocks[1],
            },
            base: {
              interval: 88,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              interval: 88,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        b6: {
          chain: {
            mainnet: {
              interval: 88,
              ...possibleMainnetBlocks[2],
            },
            base: {
              interval: 88,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              interval: 88,
              ...possibleOptimismBlocks[2],
            },
          },
        },
        b7: {
          chain: {
            mainnet: {
              interval: 152,
              ...possibleMainnetBlocks[0],
            },
            base: {
              interval: 152,
              ...possibleBaseBlocks[0],
            },
            optimism: {
              interval: 152,
              ...possibleOptimismBlocks[0],
            },
          },
        },
        b8: {
          chain: {
            mainnet: {
              interval: 152,
              ...possibleMainnetBlocks[1],
            },
            base: {
              interval: 152,
              ...possibleBaseBlocks[1],
            },
            optimism: {
              interval: 152,
              ...possibleOptimismBlocks[1],
            },
          },
        },
        b9: {
          chain: {
            mainnet: {
              interval: 152,
              ...possibleMainnetBlocks[2],
            },
            base: {
              interval: 152,
              ...possibleBaseBlocks[2],
            },
            optimism: {
              interval: 152,
              ...possibleOptimismBlocks[2],
            },
          },
        },
      },
    });
