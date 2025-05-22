import { createConfig, factory } from "ponder";
import seedrandom from "seedrandom";
import {
  type Abi,
  type Address,
  parseAbi,
  parseAbiItem,
  zeroAddress,
} from "viem";

const possibleMainnetBlocks = [
  {
    startBlock: 13_000_000,
    endBlock: 13_010_000,
  },
  {
    startBlock: 19_000_000,
    endBlock: 19_010_000,
  },
  {
    startBlock: 19_005_000,
    endBlock: 19_015_000,
  },
] as const;
const possibleBaseBlocks = [
  {
    startBlock: 10_500_000,
    endBlock: 10_510_000,
  },
  {
    startBlock: 19_000_000,
    endBlock: 19_010_000,
  },
  {
    startBlock: 19_005_000,
    endBlock: 19_015_000,
  },
] as const;
const possibleOptimismBlocks = [
  {
    startBlock: 133_000_000,
    endBlock: 133_010_000,
  },
  {
    startBlock: 100_000_000,
    endBlock: 100_010_000,
  },
  {
    startBlock: 100_005_000,
    endBlock: 100_015_000,
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

const resolveOutcome = <T>(
  possibilities: T[] | readonly T[],
  tag: string,
  chain?: string,
): T => {
  return possibilities[
    Math.floor(
      possibilities.length *
        seedrandom(process.env.SEED + tag + (chain ?? ""))(),
    )
  ]!;
};

// export default createConfig({
//   ordering: resolveOutcome(["omnichain", "multichain"], "ordering"),
//   chains: {
//     mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
//     base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
//     optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
//   },
//   contracts: {
//     c: {
//       abi: parseAbi([
//         "event Transfer(address indexed from, address indexed to, uint256 value)",
//         "function transfer(address to, uint256 amount) external returns (bool)",
//       ]),
//       chain: {
//         mainnet: {
//           address: resolveOutcome(
//             [
//               "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
//               [
//                 "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
//                 "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
//               ] as Address[],
//               factory({
//                 address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
//                 event: parseAbiItem(
//                   "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
//                 ),
//                 parameter: "pair",
//               }),
//             ],
//             "contractAddress",
//             "mainnet",
//           ),
//           includeCallTraces: resolveOutcome(
//             [true, false],
//             "includeCallTraces",
//             "mainnet",
//           ),
//           includeTransactionReceipts: resolveOutcome(
//             [true, false],
//             "includeTransactionReceipts",
//             "mainnet",
//           ),
//           filter: resolveOutcome(possibleContractFilters, "filter", "mainnet"),
//           ...resolveOutcome(possibleMainnetBlocks, "blocks", "mainnet"),
//         },
//         base: {
//           address: resolveOutcome(
//             [
//               "0x4200000000000000000000000000000000000006",
//               [
//                 "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
//                 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
//               ],
//               factory({
//                 address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
//                 event: parseAbiItem(
//                   "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
//                 ),
//                 parameter: "pair",
//               }),
//             ],
//             "contractAddress",
//             "base",
//           ),
//           includeCallTraces: resolveOutcome(
//             [true, false],
//             "includeCallTraces",
//             "base",
//           ),
//           includeTransactionReceipts: resolveOutcome(
//             [true, false],
//             "includeTransactionReceipts",
//             "base",
//           ),
//           filter: resolveOutcome(possibleContractFilters, "filter", "base"),
//           ...resolveOutcome(possibleBaseBlocks, "blocks", "base"),
//         },
//         optimism: {
//           address: resolveOutcome(
//             [
//               "0x4200000000000000000000000000000000000006",
//               [
//                 "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
//                 "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
//               ],
//               factory({
//                 address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
//                 event: parseAbiItem(
//                   "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
//                 ),
//                 parameter: "pair",
//               }),
//             ],
//             "contractAddress",
//             "optimism",
//           ),
//           includeCallTraces: resolveOutcome(
//             [true, false],
//             "includeCallTraces",
//             "optimism",
//           ),
//           includeTransactionReceipts: resolveOutcome(
//             [true, false],
//             "includeTransactionReceipts",
//             "optimism",
//           ),
//           filter: resolveOutcome(possibleContractFilters, "filter", "optimism"),
//           ...resolveOutcome(possibleOptimismBlocks, "blocks", "optimism"),
//         },
//       },
//     },
//   },
//   accounts: {
//     a: {
//       address: zeroAddress,
//       chain: {
//         mainnet: {
//           address: resolveOutcome(
//             [
//               "0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
//               [
//                 "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
//                 "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
//               ] as Address[],
//               factory({
//                 address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
//                 event: parseAbiItem(
//                   "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
//                 ),
//                 parameter: "pair",
//               }),
//             ],
//             "address",
//             "mainnet",
//           ),
//           includeTransactionReceipts: resolveOutcome(
//             [true, false],
//             "includeTransactionReceipts",
//             "mainnet",
//           ),
//           ...resolveOutcome(possibleMainnetBlocks, "blocks", "mainnet"),
//         },
//         base: {
//           address: resolveOutcome(
//             [
//               "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
//               [
//                 "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
//                 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
//               ],
//               factory({
//                 address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
//                 event: parseAbiItem(
//                   "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
//                 ),
//                 parameter: "pair",
//               }),
//             ],
//             "address",
//             "base",
//           ),
//           includeTransactionReceipts: resolveOutcome(
//             [true, false],
//             "includeTransactionReceipts",
//             "base",
//           ),
//           ...resolveOutcome(possibleBaseBlocks, "blocks", "base"),
//         },
//         optimism: {
//           address: resolveOutcome(
//             [
//               "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
//               [
//                 "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
//                 "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
//               ],
//               factory({
//                 address: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf",
//                 event: parseAbiItem(
//                   "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
//                 ),
//                 parameter: "pair",
//               }),
//             ],
//             "address",
//             "optimism",
//           ),
//           includeTransactionReceipts: resolveOutcome(
//             [true, false],
//             "includeTransactionReceipts",
//             "optimism",
//           ),
//           ...resolveOutcome(possibleOptimismBlocks, "blocks", "optimism"),
//         },
//       },
//     },
//   },
//   blocks: {
//     b: {
//       chain: {
//         mainnet: {
//           interval: resolveOutcome([50, 88, 152], "interval", "mainnet"),
//           ...resolveOutcome(possibleMainnetBlocks, "blocks", "mainnet"),
//         },
//         base: {
//           interval: resolveOutcome([50, 88, 152], "interval", "base"),
//           ...resolveOutcome(possibleBaseBlocks, "blocks", "base"),
//         },
//         optimism: {
//           interval: resolveOutcome([50, 88, 152], "interval", "optimism"),
//           ...resolveOutcome(possibleOptimismBlocks, "blocks", "optimism"),
//         },
//       },
//     },
//   },
// });

export default createConfig({
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
            "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ],
          includeCallTraces: true,
          includeTransactionReceipts: true,
          ...possibleMainnetBlocks[0],
        },
        base: {
          address: [
            "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ],
          includeCallTraces: true,
          includeTransactionReceipts: true,
          ...possibleBaseBlocks[0],
        },
        optimism: {
          address: [
            "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
            "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
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
            "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ],
          includeCallTraces: true,
          includeTransactionReceipts: true,
          ...possibleMainnetBlocks[1],
        },
        base: {
          address: [
            "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ],
          includeCallTraces: true,
          includeTransactionReceipts: true,
          ...possibleBaseBlocks[1],
        },
        optimism: {
          address: [
            "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
            "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
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
            "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ],
          includeCallTraces: true,
          includeTransactionReceipts: true,
          ...possibleMainnetBlocks[2],
        },
        base: {
          address: [
            "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ],
          includeCallTraces: true,
          includeTransactionReceipts: true,
          ...possibleBaseBlocks[2],
        },
        optimism: {
          address: [
            "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
            "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
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
            "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ],
          includeTransactionReceipts: true,
          ...possibleMainnetBlocks[0],
        },
        base: {
          address: [
            "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ],
          includeTransactionReceipts: true,
          ...possibleBaseBlocks[0],
        },
        optimism: {
          address: [
            "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
            "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
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
            "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ],
          includeTransactionReceipts: true,
          ...possibleMainnetBlocks[1],
        },
        base: {
          address: [
            "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ],
          includeTransactionReceipts: true,
          ...possibleBaseBlocks[1],
        },
        optimism: {
          address: [
            "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
            "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
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
            "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ],
          includeTransactionReceipts: true,
          ...possibleMainnetBlocks[2],
        },
        base: {
          address: [
            "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ],
          includeTransactionReceipts: true,
          ...possibleBaseBlocks[2],
        },
        optimism: {
          address: [
            "0x2EE4DB658906e04A10874DD8f11bFD32E4439038",
            "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
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
