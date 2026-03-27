export const OrderBookABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40",
        name: "orderId",
        type: "uint40",
      },
      {
        indexed: false,
        internalType: "address",
        name: "makerAddress",
        type: "address",
      },
      { indexed: false, internalType: "bool", name: "isBuy", type: "bool" },
      {
        indexed: false,
        internalType: "uint256",
        name: "price",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "updatedSize",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "address",
        name: "takerAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "txOrigin",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "filledSize",
        type: "uint96",
      },
    ],
    name: "Trade",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40",
        name: "orderId",
        type: "uint40",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      { indexed: false, internalType: "uint96", name: "size", type: "uint96" },
      { indexed: false, internalType: "uint32", name: "price", type: "uint32" },
      { indexed: false, internalType: "bool", name: "isBuy", type: "bool" },
    ],
    name: "OrderCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40[]",
        name: "orderId",
        type: "uint40[]",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "OrdersCanceled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40",
        name: "orderId",
        type: "uint40",
      },
      {
        indexed: false,
        internalType: "uint40",
        name: "flippedId",
        type: "uint40",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      { indexed: false, internalType: "uint96", name: "size", type: "uint96" },
      { indexed: false, internalType: "uint32", name: "price", type: "uint32" },
      {
        indexed: false,
        internalType: "uint32",
        name: "flippedPrice",
        type: "uint32",
      },
      { indexed: false, internalType: "bool", name: "isBuy", type: "bool" },
    ],
    name: "FlipOrderCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40",
        name: "orderId",
        type: "uint40",
      },
      {
        indexed: false,
        internalType: "uint40",
        name: "flippedId",
        type: "uint40",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      { indexed: false, internalType: "uint96", name: "size", type: "uint96" },
      { indexed: false, internalType: "uint32", name: "price", type: "uint32" },
      {
        indexed: false,
        internalType: "uint32",
        name: "flippedPrice",
        type: "uint32",
      },
      { indexed: false, internalType: "bool", name: "isBuy", type: "bool" },
    ],
    name: "FlippedOrderCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40",
        name: "orderId",
        type: "uint40",
      },
      { indexed: false, internalType: "uint96", name: "size", type: "uint96" },
    ],
    name: "FlipOrderUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint40[]",
        name: "orderIds",
        type: "uint40[]",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "FlipOrdersCanceled",
    type: "event",
  },
] as const;
