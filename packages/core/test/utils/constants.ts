export const accounts = [
  {
    address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    balance: 10000000000000000000000n,
    privateKey:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x976ea74026e726554db657fa54763abd0c3a0aa9",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
    balance: 10000000000000000000000n,
  },
  {
    address: "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f",
    balance: 10000000000000000000000n,
  },
  {
    address: "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
    balance: 10000000000000000000000n,
  },
] as const;

export const vitalik = {
  address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  account: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
} as const;

export const usdcContractConfig = {
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  abi: [
    {
      type: "event",
      name: "Approval",
      inputs: [
        {
          indexed: true,
          name: "owner",
          type: "address",
        },
        {
          indexed: true,
          name: "spender",
          type: "address",
        },
        {
          indexed: false,
          name: "value",
          type: "uint256",
        },
      ],
    },
    {
      type: "event",
      name: "Transfer",
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
          name: "value",
          type: "uint256",
        },
      ],
    },
    {
      type: "function",
      name: "allowance",
      stateMutability: "view",
      inputs: [
        {
          name: "owner",
          type: "address",
        },
        {
          name: "spender",
          type: "address",
        },
      ],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "approve",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "spender",
          type: "address",
        },
        {
          name: "amount",
          type: "uint256",
        },
      ],
      outputs: [{ type: "bool" }],
    },
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [
        {
          name: "account",
          type: "address",
        },
      ],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "decimals",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint8" }],
    },
    {
      type: "function",
      name: "name",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "string" }],
    },
    {
      type: "function",
      name: "symbol",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "string" }],
    },
    {
      type: "function",
      name: "totalSupply",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "recipient",
          type: "address",
        },
        {
          name: "amount",
          type: "uint256",
        },
      ],
      outputs: [{ type: "bool" }],
    },
    {
      type: "function",
      name: "transferFrom",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "sender",
          type: "address",
        },
        {
          name: "recipient",
          type: "address",
        },
        {
          name: "amount",
          type: "uint256",
        },
      ],
      outputs: [{ type: "bool" }],
    },
    {
      type: "function",
      name: "increaseAllowance",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "spender",
          type: "address",
        },
        {
          name: "addedValue",
          type: "uint256",
        },
      ],
      outputs: [{ type: "bool" }],
    },
    {
      type: "function",
      name: "decreaseAllowance",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "spender",
          type: "address",
        },
        {
          name: "subtractedValue",
          type: "uint256",
        },
      ],
      outputs: [{ type: "bool" }],
    },
  ],
} as const;
