import { createConfig, factory } from "ponder";
import seedrandom from "seedrandom";
import { type Address, parseAbi, parseAbiItem, zeroAddress } from "viem";

// Note this is copied from index.ts to avoid circular dependency that vite
// cannot currently handle.
const pick = <T>(possibilities: T[] | readonly T[], tag: string): T => {
  return possibilities[
    Math.floor(possibilities.length * seedrandom(process.env.SEED + tag)())
  ]!;
};

const possibleMainnetBlocks = [
  {
    startBlock: 13_000_000,
    endBlock: 13_001_000,
  },
  {
    startBlock: 22_546_000,
    endBlock: 22_547_000,
  },
  {
    startBlock: 22_546_500,
    endBlock: 22_547_500,
  },
] as const;
const possibleBaseBlocks = [
  {
    startBlock: 10_500_000,
    endBlock: 10_501_000,
  },
  {
    startBlock: 30_617_500,
    endBlock: 30_618_500,
  },
  {
    startBlock: 30_618_000,
    endBlock: 30_619_000,
  },
] as const;
const possibleOptimismBlocks = [
  {
    startBlock: 133_000_000,
    endBlock: 133_001_000,
  },
  {
    startBlock: 136_212_500,
    endBlock: 136_213_500,
  },
  {
    startBlock: 136_213_000,
    endBlock: 136_214_000,
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
] as const;

export default process.env.SEED
  ? createConfig({
      database: {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
        poolConfig: { max: 11 },
      },
      chains: {
        mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
        base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
        optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
      },
      contracts: {
        c: {
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
            "function transfer(address to, uint256 amount) external returns (bool)",
          ]),
          chain: {
            mainnet: {
              address: pick(
                [
                  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
                  [
                    "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                    "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
                  ] as Address[],
                  factory({
                    address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                    event: parseAbiItem(
                      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                    ),
                    parameter: "pair",
                  }),
                ],
                "contract_address_mainnet",
              ),
              includeCallTraces: pick(
                [true, false],
                "contract_includeCallTraces_mainnet",
              ),
              includeTransactionReceipts: pick(
                [true, false],
                "contract_includeTransactionReceipts_mainnet",
              ),
              filter: pick(possibleContractFilters, "contract_filter_mainnet"),
              ...pick(possibleMainnetBlocks, "contract_blocks_mainnet"),
            },
            base: {
              address: pick(
                [
                  "0x4200000000000000000000000000000000000006",
                  [
                    "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                    "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
                  ],
                  factory({
                    address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                    event: parseAbiItem(
                      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                    ),
                    parameter: "pair",
                  }),
                ],
                "contract_address_base",
              ),
              includeCallTraces: pick(
                [true, false],
                "contract_includeCallTraces_base",
              ),
              includeTransactionReceipts: pick(
                [true, false],
                "contract_includeTransactionReceipts_base",
              ),
              filter: pick(possibleContractFilters, "contract_filter_base"),
              ...pick(possibleBaseBlocks, "contract_blocks_base"),
            },
            optimism: {
              address: pick(
                [
                  "0x4200000000000000000000000000000000000006",
                  [
                    "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                    "0xFdb794692724153d1488CcdBE0C56c252596735F",
                  ],
                  factory({
                    address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                    event: parseAbiItem(
                      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                    ),
                    parameter: "pair",
                  }),
                ],
                "contract_address_optimism",
              ),
              includeCallTraces: pick(
                [true, false],
                "contract_includeCallTraces_optimism",
              ),
              includeTransactionReceipts: pick(
                [true, false],
                "contract_includeTransactionReceipts_optimism",
              ),
              filter: pick(possibleContractFilters, "contract_filter_optimism"),
              ...pick(possibleOptimismBlocks, "contract_blocks_optimism"),
            },
          },
        },
      },
      accounts: {
        a: {
          address: zeroAddress,
          chain: {
            mainnet: {
              address: pick(
                [
                  "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
                  [
                    "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
                    "0xc944E90C64B2c07662A292be6244BDf05Cda44a7",
                  ] as Address[],
                  factory({
                    address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
                    event: parseAbiItem(
                      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                    ),
                    parameter: "pair",
                  }),
                ],
                "account_address_mainnet",
              ),
              includeTransactionReceipts: pick(
                [true, false],
                "account_includeTransactionReceipts_mainnet",
              ),
              ...pick(possibleMainnetBlocks, "account_blocks_mainnet"),
            },
            base: {
              address: pick(
                [
                  "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
                  [
                    "0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7",
                    "0x4A3A6Dd60A34bB2Aba60D73B4C88315E9CeB6A3D",
                  ],
                  factory({
                    address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
                    event: parseAbiItem(
                      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                    ),
                    parameter: "pair",
                  }),
                ],
                "account_address_base",
              ),
              includeTransactionReceipts: pick(
                [true, false],
                "account_includeTransactionReceipts_base",
              ),
              ...pick(possibleBaseBlocks, "account_blocks_base"),
            },
            optimism: {
              address: pick(
                [
                  "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
                  [
                    "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
                    "0xFdb794692724153d1488CcdBE0C56c252596735F",
                  ],
                  factory({
                    address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
                    event: parseAbiItem(
                      "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
                    ),
                    parameter: "pair",
                  }),
                ],
                "account_address_optimism",
              ),
              includeTransactionReceipts: pick(
                [true, false],
                "account_includeTransactionReceipts_optimism",
              ),
              ...pick(possibleOptimismBlocks, "account_blocks_optimism"),
            },
          },
        },
      },
      blocks: {
        b: {
          chain: {
            mainnet: {
              interval: pick([50, 88, 152], "block_interval_mainnet"),
              ...pick(possibleMainnetBlocks, "block_blocks_mainnet"),
            },
            base: {
              interval: pick([50, 88, 152], "block_interval_base"),
              ...pick(possibleBaseBlocks, "block_blocks_base"),
            },
            optimism: {
              interval: pick([50, 88, 152], "block_interval_optimism"),
              ...pick(possibleOptimismBlocks, "block_blocks_optimism"),
            },
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
