export const FileStoreFrontendAbi = [
  {
    inputs: [
      {
        internalType: "contract IContentStore",
        name: "contentStore",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "checksum",
        type: "bytes32",
      },
    ],
    name: "getContent",
    outputs: [
      {
        internalType: "bytes",
        name: "content",
        type: "bytes",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IFileStore",
        name: "fileStore",
        type: "address",
      },
      {
        internalType: "string",
        name: "filename",
        type: "string",
      },
    ],
    name: "readFile",
    outputs: [
      {
        internalType: "string",
        name: "contents",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
