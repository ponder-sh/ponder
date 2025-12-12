import { toEventSelector } from "viem";
import { describe, expect, test } from "vitest";
import { decodeEventLog } from "./decodeEventLog.js";

test("named args: Transfer(address,address,uint256)", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          name: "from",
          type: "address",
        },
        {
          indexed: true,
          name: "to",
          type: "address",
        },
        {
          indexed: false,
          name: "tokenId",
          type: "uint256",
        },
      ],
      name: "Transfer",
      type: "event",
    },
    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    ],
  });

  expect(event).toEqual({
    from: "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    to: "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    tokenId: 1n,
  });
});

test("named args with a missing name: Transfer(address,address,uint256)", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          name: "from",
          type: "address",
        },
        {
          indexed: true,
          name: "to",
          type: "address",
        },
        {
          indexed: false,
          name: "",
          type: "uint256",
        },
      ],
      name: "Transfer",
      type: "event",
    },

    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    ],
  });

  expect(event).toEqual([
    "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    1n,
  ]);
});

test("unnamed args: Transfer(address,address,uint256)", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          type: "address",
        },
        {
          indexed: true,
          type: "address",
        },
        {
          indexed: false,
          type: "uint256",
        },
      ],
      name: "Transfer",
      type: "event",
    },
    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    ],
  });
  expect(event).toEqual([
    "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    1n,
  ]);
});

test("unnamed args: mixed ordering of indexed args", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          type: "address",
        },
        {
          indexed: false,
          type: "uint256",
        },
        {
          indexed: true,
          type: "address",
        },
      ],
      name: "Transfer",
      type: "event",
    },
    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    topics: [
      "0x138dbc8474f748db86063dcef24cef1495bc73385a946f8d691128085e5ebec2",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
      "0x000000000000000000000000a5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    ],
  });
  expect(event).toEqual([
    "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
    1n,
    "0xa5cc3c03994db5b0d9a5eedd10cabab0813678ac",
  ]);
});

test("Foo(string)", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          name: "message",
          type: "string",
        },
      ],
      name: "Foo",
      type: "event",
    },
    data: "0x",
    topics: [
      "0x9f0b7f1630bdb7d474466e2dfef0fb9dff65f7a50eec83935b68f77d0808f08a",
      "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
    ],
  });
  expect(event).toEqual({
    message:
      "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
  });
});

test("args: eventName", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          name: "message",
          type: "string",
        },
      ],
      name: "Foo",
      type: "event",
    },
    data: "0x",
    topics: [
      "0x9f0b7f1630bdb7d474466e2dfef0fb9dff65f7a50eec83935b68f77d0808f08a",
      "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
    ],
  });
  expect(event).toEqual({
    message:
      "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
  });
});

test("args: data – named (address,address,uint256)", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          name: "from",
          type: "address",
        },
        {
          indexed: true,
          name: "to",
          type: "address",
        },
        {
          indexed: false,
          name: "tokenId",
          type: "uint256",
        },
      ],
      name: "Transfer",
      type: "event",
    },
    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
      "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    ],
  });
  expect(event).toEqual({
    from: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    to: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    tokenId: 1n,
  });
});

test("args: data – unnamed (address,address,uint256)", () => {
  const event = decodeEventLog({
    abiItem: {
      inputs: [
        {
          indexed: true,
          type: "address",
        },
        {
          indexed: true,
          type: "address",
        },
        {
          indexed: false,
          type: "uint256",
        },
      ],
      name: "Transfer",
      type: "event",
    },
    data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
      "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    ],
  });
  expect(event).toEqual([
    "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    1n,
  ]);
});

test("named: topics + event params mismatch", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            name: "from",
            type: "address",
          },
          {
            indexed: false,
            name: "to",
            type: "address",
          },
          {
            indexed: true,
            name: "id",
            type: "uint256",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0x",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
    }),
  ).toThrowError(
    `Expected a topic for indexed event parameter "id" on event "Transfer(address from, address to, uint256 id)".`,
  );
});

test("unnamed: topics + event params mismatch", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            type: "address",
          },
          {
            indexed: false,
            type: "address",
          },
          {
            indexed: true,
            type: "uint256",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0x",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
    }),
  ).toThrowError(
    `Expected a topic for indexed event parameter on event "Transfer(address, address, uint256)".`,
  );
});

test("data + event params mismatch", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        anonymous: false,
        inputs: [
          {
            indexed: true,

            name: "from",
            type: "address",
          },
          {
            indexed: false,

            name: "to",
            type: "address",
          },
          {
            indexed: false,

            name: "id",
            type: "uint256",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0x0000000000000000000000000000000000000000000000000000000023c34600",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "0x00000000000000000000000070e8a65d014918798ba424110d5df658cde1cc58",
      ],
    }),
  ).toThrowError("Invalid data length");

  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            name: "from",
            type: "address",
          },
          {
            indexed: false,
            name: "to",
            type: "address",
          },
          {
            indexed: true,
            name: "id",
            type: "uint256",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0x",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    }),
  ).toThrowError(
    "Data size of 0 bytes is too small for non-indexed event parameters.",
  );

  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            name: "from",
            type: "address",
          },
          {
            indexed: false,
            name: "to",
            type: "address",
          },
          {
            indexed: true,
            name: "id",
            type: "uint256",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0x",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    }),
  ).toThrowError(
    "Data size of 0 bytes is too small for non-indexed event parameters.",
  );
});

describe("GitHub repros", () => {
  describe("https://github.com/wevm/viem/issues/168", () => {
    test("zero data string", () => {
      const result = decodeEventLog({
        abiItem: {
          anonymous: false,
          inputs: [
            {
              indexed: false,

              name: "voter",
              type: "address",
            },
            {
              indexed: false,

              name: "proposalId",
              type: "bytes32",
            },
            {
              indexed: false,

              name: "support",
              type: "uint256",
            },
            {
              indexed: false,

              name: "weight",
              type: "uint256",
            },
            {
              indexed: false,

              name: "reason",
              type: "string",
            },
          ],
          name: "VoteCast",
          type: "event",
        },

        data: "0x000000000000000000000000d1d1d4e36117ab794ec5d4c78cbd3a8904e691d04bdc559e89b88b73d8edeea6a767041d448d8076d070facc8340621555be3ac40000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000",
        topics: [
          "0x0c165c85edbf8f9b99d51793c9429beb9dc2b608a7f81e64623052f829657af3",
        ],
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "proposalId": "0x4bdc559e89b88b73d8edeea6a767041d448d8076d070facc8340621555be3ac4",
          "reason": "",
          "support": 1n,
          "voter": "0xd1d1d4e36117ab794ec5d4c78cbd3a8904e691d0",
          "weight": 1n,
        }
      `);
    });
  });

  describe("https://github.com/wevm/viem/issues/197", () => {
    test("topics + event params mismatch", () => {
      expect(() =>
        decodeEventLog({
          abiItem: {
            anonymous: false,
            inputs: [
              {
                indexed: true,

                name: "from",
                type: "address",
              },
              {
                indexed: true,

                name: "to",
                type: "address",
              },
              {
                indexed: true,

                name: "id",
                type: "uint256",
              },
            ],
            name: "Transfer",
            type: "event",
          },
          data: "0x0000000000000000000000000000000000000000000000000000000023c34600",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            "0x00000000000000000000000070e8a65d014918798ba424110d5df658cde1cc58",
          ],
        }),
      ).toThrowError(
        `Expected a topic for indexed event parameter "id" on event "Transfer(address from, address to, uint256 id)".`,
      );
    });
  });

  describe("https://github.com/wevm/viem/issues/323", () => {
    test("data + params mismatch", () => {
      expect(() =>
        decodeEventLog({
          abiItem: {
            anonymous: false,
            inputs: [
              {
                indexed: true,

                name: "from",
                type: "address",
              },
              {
                indexed: false,

                name: "to",
                type: "address",
              },
              {
                indexed: false,

                name: "id",
                type: "uint256",
              },
            ],
            name: "Transfer",
            type: "event",
          },
          data: "0x0000000000000000000000000000000000000000000000000000000023c34600",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            "0x00000000000000000000000070e8a65d014918798ba424110d5df658cde1cc58",
          ],
        }),
      ).toThrowError("Invalid data length.");
    });
  });

  describe("https://github.com/wevm/viem/issues/1336", () => {
    test("topics + event params mismatch", () => {
      expect(() =>
        decodeEventLog({
          abiItem: {
            anonymous: false,
            inputs: [
              {
                indexed: true,

                name: "nounId",
                type: "uint256",
              },
              {
                indexed: false,

                name: "startTime",
                type: "uint256",
              },
              {
                indexed: false,

                name: "endTime",
                type: "uint256",
              },
            ],
            name: "AuctionCreated",
            type: "event",
          },
          data: "0x00000000000000000000000000000000000000000000000000000000000000680000000000000000000000000000000000000000000000004563918244f400000000000000000000000000000000000000000000000000000000000062845fba",
          topics: [
            "0xd6eddd1118d71820909c1197aa966dbc15ed6f508554252169cc3d5ccac756ca",
          ],
        }),
      ).toThrowError(
        `Expected a topic for indexed event parameter "nounId" on event "AuctionCreated(uint256 nounId, uint256 startTime, uint256 endTime)".`,
      );
    });
  });
});

test("errors: no topics", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            name: "message",
            type: "string",
          },
        ],
        name: "Bar",
        type: "event",
      },
      data: "0x",
      topics: [],
    }),
  ).toThrowError(
    `Expected a topic for indexed event parameter "message" on event "Bar(string message)".`,
  );
});

test("errors: invalid data size", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            name: "from",
            type: "address",
          },
          {
            indexed: true,
            name: "to",
            type: "address",
          },
          {
            indexed: false,
            name: "tokenId",
            type: "uint256",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0x1",

      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
    }),
  ).toThrowError("Data size of 0.5 bytes is too small for given parameters.");
});

test("errors: invalid bool", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        inputs: [
          {
            indexed: true,
            name: "from",
            type: "address",
          },
          {
            indexed: true,
            name: "to",
            type: "address",
          },
          {
            indexed: false,
            name: "sender",
            type: "bool",
          },
        ],
        name: "Transfer",
        type: "event",
      },
      data: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",

      topics: [
        toEventSelector("Transfer(address,address,bool)"),
        "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
        "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
    }),
  ).toThrowError(
    `Hex value "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" is not a valid boolean. The hex value must be "0x0" (false) or "0x1" (true).`,
  );
});

test("errors: namehash", () => {
  expect(() =>
    decodeEventLog({
      abiItem: {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "bytes32",
            name: "node",
            type: "bytes32",
          },
          {
            indexed: true,
            internalType: "string",
            name: "indexedKey",
            type: "string",
          },
          {
            indexed: false,
            internalType: "string",
            name: "key",
            type: "string",
          },
        ],
        name: "TextChanged",
        type: "event",
      },
      // topics/data from https://etherscan.io/tx/0x1c852ec21dc816060052a2320e16116aac645b41b5321afd4f9992178947ba5d#eventlog
      // @ts-ignore
      topics: [
        "0xd8c9334b1a9c2f9da342a0a2b32629c1a229b6445dad78947f674b44444a7550",
        "0x4aeacf8a996820a6609013324038be7f8d07ff9185f50063e7bf81915e6d2c08",
        null,
        null,
      ],
      data: "0x00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000375726c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000375726c0000000000000000000000000000000000000000000000000000000000",
    }),
  ).toThrow(/Expected a topic for indexed event parameter/);
});
