import { ALICE } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import { getBlocksConfigAndIndexingFunctions } from "@/_test/utils.js";
import type { BlockEvent, LogEvent, TraceEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { getAbiItem, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { recordProfilePattern, recoverProfilePattern } from "./profile.js";

beforeEach(setupCommon);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("recordProfilePattern() with undefined log event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() with undefined trace event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "trace",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: undefined,
      result: undefined,
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies TraceEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() with array log event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() with array trace event args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "trace",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: [],
      result: [],
      trace: {} as TraceEvent["event"]["trace"],
      transaction: {} as TraceEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies TraceEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "constant",
          "value": "0x0000000000000000000000000000000000000000",
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() address", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: {
        number: 1n,
      } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "totalSupply",
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": false,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": undefined,
        "functionName": "totalSupply",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": undefined,
      "blockNumber": 1n,
      "chainId": 1,
      "functionName": "totalSupply",
    }
  `);
});

test("recordProfilePattern() args", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {
        address: ALICE,
      } as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": false,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": [
          {
            "type": "derived",
            "value": [
              "log",
              "address",
            ],
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() constants", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  const pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});

test("recordProfilePattern() hint", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const event = {
    type: "log",
    chain: app.indexingBuild.chain,
    eventCallback: app.indexingBuild.eventCallbacks[0]!,
    checkpoint: ZERO_CHECKPOINT_STRING,
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: { address: zeroAddress },
      log: {} as unknown as LogEvent["event"]["log"],
      transaction: {} as LogEvent["event"]["transaction"],
      block: { number: 5n } as BlockEvent["event"]["block"],
    },
  } satisfies LogEvent;

  let pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [],
  });

  pattern = recordProfilePattern({
    event,
    args: {
      address: zeroAddress,
      abi: [getAbiItem({ abi: erc20ABI, name: "balanceOf" })],
      functionName: "balanceOf",
      args: [ALICE],
    },
    hints: [pattern!],
  });

  expect(pattern).toMatchInlineSnapshot(`
    {
      "hasConstant": true,
      "pattern": {
        "abi": [
          {
            "inputs": [
              {
                "internalType": "address",
                "name": "",
                "type": "address",
              },
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
              },
            ],
            "stateMutability": "view",
            "type": "function",
          },
        ],
        "address": {
          "type": "derived",
          "value": [
            "args",
            "address",
          ],
        },
        "args": [
          {
            "type": "constant",
            "value": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "functionName": "balanceOf",
      },
    }
  `);

  expect(recoverProfilePattern(pattern!.pattern, event)).toMatchInlineSnapshot(`
    {
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address",
            },
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256",
            },
          ],
          "stateMutability": "view",
          "type": "function",
        },
      ],
      "address": "0x0000000000000000000000000000000000000000",
      "args": [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ],
      "blockNumber": 5n,
      "chainId": 1,
      "functionName": "balanceOf",
    }
  `);
});
