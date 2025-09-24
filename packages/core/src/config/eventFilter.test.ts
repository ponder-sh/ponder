import { parseAbiItem, parseEther, zeroAddress } from "viem";
import { expect, test } from "vitest";
import { createConfig } from "./index.js";

const ALICE = "0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45";
const BOB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// Simple ERC20 ABI for testing
const erc20ABI = [
  parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 amount)",
  ),
  parseAbiItem("function transfer(address to, uint256 amount) returns (bool)"),
  parseAbiItem("function balanceOf(address account) view returns (uint256)"),
] as const;

test("createConfig with condition function in event filter", () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: process.env.PRC_URL_1,
      },
    },
    contracts: {
      ERC20: {
        abi: erc20ABI,
        address: "0xA0b86a33E6441e6e80D0c4C34F4f5c8B8E6C8D8E",
        chain: "mainnet",
        filter: {
          event: "Transfer",
          args: {
            from: zeroAddress,
          },
          condition: ({ event, context }: any) => {
            const args = event.args as any;
            return args.amount > parseEther("0.5");
          },
        },
      },
    },
  });

  expect(config).toBeDefined();
  expect(config.contracts.ERC20.filter).toBeDefined();
  expect((config.contracts.ERC20.filter as any).condition).toBeDefined();
  expect(typeof (config.contracts.ERC20.filter as any).condition).toBe(
    "function",
  );
});

test("createConfig with multiple event filters including condition functions", () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: process.env.PRC_URL_1,
      },
    },
    contracts: {
      ERC20: {
        abi: erc20ABI,
        address: "0xA0b86a33E6441e6e80D0c4C34F4f5c8B8E6C8D8E",
        chain: "mainnet",
        filter: [
          {
            event: "Transfer",
            args: {
              from: zeroAddress,
            },
            condition: ({ event, context }: any) => {
              const args = event.args as any;
              return args.amount > parseEther("1");
            },
          },
          {
            event: "Transfer",
            args: {
              to: ALICE,
            },
            condition: ({ event, context }: any) => {
              const args = event.args as any;
              return args.amount < parseEther("10");
            },
          },
        ],
      },
    },
  });

  expect(config).toBeDefined();
  expect(Array.isArray(config.contracts.ERC20.filter)).toBe(true);
  expect(config.contracts.ERC20.filter as any).toHaveLength(2);

  const filters = config.contracts.ERC20.filter as any[];
  expect(filters[0].condition).toBeDefined();
  expect(typeof filters[0].condition).toBe("function");
  expect(filters[1].condition).toBeDefined();
  expect(typeof filters[1].condition).toBe("function");
});

test("createConfig with event filter without condition function", () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: process.env.PRC_URL_1,
      },
    },
    contracts: {
      ERC20: {
        abi: erc20ABI,
        address: "0xA0b86a33E6441e6e80D0c4C34F4f5c8B8E6C8D8E",
        chain: "mainnet",
        filter: {
          event: "Transfer",
          args: {
            from: zeroAddress,
          },
        },
      },
    },
  });

  expect(config).toBeDefined();
  expect(config.contracts.ERC20.filter).toBeDefined();
  expect((config.contracts.ERC20.filter as any).condition).toBeUndefined();
});

test("createConfig with no event filter", () => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: process.env.PRC_URL_1,
      },
    },
    contracts: {
      ERC20: {
        abi: erc20ABI,
        address: "0xA0b86a33E6441e6e80D0c4C34F4f5c8B8E6C8D8E",
        chain: "mainnet",
      },
    },
  });

  expect(config).toBeDefined();
  expect((config.contracts.ERC20 as any).filter).toBeUndefined();
});
