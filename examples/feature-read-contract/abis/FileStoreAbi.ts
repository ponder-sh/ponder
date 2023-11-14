export const FileStoreAbi = [
  {
    inputs: [
      {
        internalType: "contract IContentStore",
        name: "_contentStore",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  { inputs: [], name: "EmptyFile", type: "error" },
  {
    inputs: [{ internalType: "string", name: "filename", type: "string" }],
    name: "FileNotFound",
    type: "error",
  },
  {
    inputs: [{ internalType: "string", name: "filename", type: "string" }],
    name: "FilenameExists",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "string",
        name: "indexedFilename",
        type: "string",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "checksum",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "string",
        name: "filename",
        type: "string",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "size",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "metadata",
        type: "bytes",
      },
    ],
    name: "FileCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "string",
        name: "indexedFilename",
        type: "string",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "checksum",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "string",
        name: "filename",
        type: "string",
      },
    ],
    name: "FileDeleted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "contentStore",
    outputs: [
      {
        internalType: "contract IContentStore",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "filename", type: "string" },
      { internalType: "bytes32[]", name: "checksums", type: "bytes32[]" },
    ],
    name: "createFile",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "size", type: "uint256" },
          {
            components: [
              {
                internalType: "bytes32",
                name: "checksum",
                type: "bytes32",
              },
              {
                internalType: "address",
                name: "pointer",
                type: "address",
              },
            ],
            internalType: "struct Content[]",
            name: "contents",
            type: "tuple[]",
          },
        ],
        internalType: "struct File",
        name: "file",
        type: "tuple",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "filename", type: "string" },
      { internalType: "bytes32[]", name: "checksums", type: "bytes32[]" },
      { internalType: "bytes", name: "extraData", type: "bytes" },
    ],
    name: "createFile",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "size", type: "uint256" },
          {
            components: [
              {
                internalType: "bytes32",
                name: "checksum",
                type: "bytes32",
              },
              {
                internalType: "address",
                name: "pointer",
                type: "address",
              },
            ],
            internalType: "struct Content[]",
            name: "contents",
            type: "tuple[]",
          },
        ],
        internalType: "struct File",
        name: "file",
        type: "tuple",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "filename", type: "string" }],
    name: "deleteFile",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "filename", type: "string" }],
    name: "fileExists",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "", type: "string" }],
    name: "files",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "filename", type: "string" }],
    name: "getChecksum",
    outputs: [{ internalType: "bytes32", name: "checksum", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "filename", type: "string" }],
    name: "getFile",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "size", type: "uint256" },
          {
            components: [
              {
                internalType: "bytes32",
                name: "checksum",
                type: "bytes32",
              },
              {
                internalType: "address",
                name: "pointer",
                type: "address",
              },
            ],
            internalType: "struct Content[]",
            name: "contents",
            type: "tuple[]",
          },
        ],
        internalType: "struct File",
        name: "file",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
