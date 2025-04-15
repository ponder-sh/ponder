import { ALICE } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import type { BlockEvent, LogEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { getAbiItem, zeroAddress } from "viem";
import { expect, test } from "vitest";
import { recordProfilePattern, recoverProfilePattern } from "./profile.js";

test("recordProfilePattern() address", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
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

test("recordProfilePattern() args", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
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

test("recordProfilePattern() constants", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
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

test("recordProfilePattern() hint", () => {
  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "",
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
