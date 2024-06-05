//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Counter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const counterABI = [
  {
    stateMutability: "nonpayable",
    type: "function",
    inputs: [],
    name: "increment",
    outputs: [],
  },
  {
    stateMutability: "view",
    type: "function",
    inputs: [],
    name: "number",
    outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "value",
        internalType: "uint256",
        type: "uint256",
        indexed: false,
      },
    ],
    name: "Incremented",
  },
] as const;
