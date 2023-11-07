export const LlamaPolicyAbi = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  { inputs: [], name: "ActionCreationAtSameTimestamp", type: "error" },
  {
    inputs: [{ internalType: "address", name: "userAddress", type: "address" }],
    name: "AddressDoesNotHoldPolicy",
    type: "error",
  },
  { inputs: [], name: "AllHoldersRole", type: "error" },
  { inputs: [], name: "AlreadyInitialized", type: "error" },
  { inputs: [], name: "InvalidIndices", type: "error" },
  { inputs: [], name: "InvalidRoleHolderInput", type: "error" },
  { inputs: [], name: "NonTransferableToken", type: "error" },
  { inputs: [], name: "OnlyLlama", type: "error" },
  { inputs: [], name: "OnlyLlamaFactory", type: "error" },
  {
    inputs: [{ internalType: "uint8", name: "role", type: "uint8" }],
    name: "RoleNotInitialized",
    type: "error",
  },
  {
    inputs: [{ internalType: "uint256", name: "n", type: "uint256" }],
    name: "UnsafeCast",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "id",
        type: "uint256",
      },
    ],
    name: "Approval",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "operator",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "approved",
        type: "bool",
      },
    ],
    name: "ApprovalForAll",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "caller",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "policyholder",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "role",
        type: "uint8",
      },
    ],
    name: "ExpiredRoleRevoked",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "version",
        type: "uint8",
      },
    ],
    name: "Initialized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "contract ILlamaPolicyMetadata",
        name: "policyMetadata",
        type: "address",
      },
      {
        indexed: true,
        internalType: "contract ILlamaPolicyMetadata",
        name: "policyMetadataLogic",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "initializationData",
        type: "bytes",
      },
    ],
    name: "PolicyMetadataSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "policyholder",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "role",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "expiration",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "quantity",
        type: "uint96",
      },
    ],
    name: "RoleAssigned",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint8",
        name: "role",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "RoleDescription",
        name: "description",
        type: "bytes32",
      },
    ],
    name: "RoleInitialized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint8",
        name: "role",
        type: "uint8",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "permissionId",
        type: "bytes32",
      },
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bytes4", name: "selector", type: "bytes4" },
          {
            internalType: "contract ILlamaStrategy",
            name: "strategy",
            type: "address",
          },
        ],
        indexed: false,
        internalType: "struct PermissionData",
        name: "permissionData",
        type: "tuple",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "hasPermission",
        type: "bool",
      },
    ],
    name: "RolePermissionAssigned",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "id",
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "approve",
    outputs: [],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "bytes32", name: "permissionId", type: "bytes32" },
    ],
    name: "canCreateAction",
    outputs: [{ internalType: "bool", name: "hasPermission", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "contractURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "getApproved",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "getPastQuantity",
    outputs: [{ internalType: "uint96", name: "", type: "uint96" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "getPastRoleSupplyAsNumberOfHolders",
    outputs: [
      { internalType: "uint96", name: "numberOfHolders", type: "uint96" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "getPastRoleSupplyAsQuantitySum",
    outputs: [
      { internalType: "uint96", name: "totalQuantity", type: "uint96" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
    ],
    name: "getQuantity",
    outputs: [{ internalType: "uint96", name: "", type: "uint96" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint8", name: "role", type: "uint8" }],
    name: "getRoleSupplyAsNumberOfHolders",
    outputs: [
      { internalType: "uint96", name: "numberOfHolders", type: "uint96" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint8", name: "role", type: "uint8" }],
    name: "getRoleSupplyAsQuantitySum",
    outputs: [
      { internalType: "uint96", name: "totalQuantity", type: "uint96" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "bytes32", name: "permissionId", type: "bytes32" },
    ],
    name: "hasPermissionId",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
    ],
    name: "hasRole",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "hasRole",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "_name", type: "string" },
      {
        components: [
          {
            internalType: "RoleDescription[]",
            name: "roleDescriptions",
            type: "bytes32[]",
          },
          {
            components: [
              { internalType: "uint8", name: "role", type: "uint8" },
              {
                internalType: "address",
                name: "policyholder",
                type: "address",
              },
              {
                internalType: "uint96",
                name: "quantity",
                type: "uint96",
              },
              {
                internalType: "uint64",
                name: "expiration",
                type: "uint64",
              },
            ],
            internalType: "struct RoleHolderData[]",
            name: "roleHolders",
            type: "tuple[]",
          },
          {
            components: [
              { internalType: "uint8", name: "role", type: "uint8" },
              {
                components: [
                  {
                    internalType: "address",
                    name: "target",
                    type: "address",
                  },
                  {
                    internalType: "bytes4",
                    name: "selector",
                    type: "bytes4",
                  },
                  {
                    internalType: "contract ILlamaStrategy",
                    name: "strategy",
                    type: "address",
                  },
                ],
                internalType: "struct PermissionData",
                name: "permissionData",
                type: "tuple",
              },
              {
                internalType: "bool",
                name: "hasPermission",
                type: "bool",
              },
            ],
            internalType: "struct RolePermissionData[]",
            name: "rolePermissions",
            type: "tuple[]",
          },
          { internalType: "string", name: "color", type: "string" },
          { internalType: "string", name: "logo", type: "string" },
        ],
        internalType: "struct LlamaPolicyConfig",
        name: "config",
        type: "tuple",
      },
      {
        internalType: "contract ILlamaPolicyMetadata",
        name: "policyMetadataLogic",
        type: "address",
      },
      { internalType: "address", name: "executor", type: "address" },
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bytes4", name: "selector", type: "bytes4" },
          {
            internalType: "contract ILlamaStrategy",
            name: "strategy",
            type: "address",
          },
        ],
        internalType: "struct PermissionData",
        name: "bootstrapPermissionData",
        type: "tuple",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "RoleDescription",
        name: "description",
        type: "bytes32",
      },
    ],
    name: "initializeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
    ],
    name: "isRoleExpired",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "llamaExecutor",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "llamaPolicyMetadata",
    outputs: [
      {
        internalType: "contract ILlamaPolicyMetadata",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "numRoles",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "owner", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "address", name: "policyholder", type: "address" },
    ],
    name: "revokeExpiredRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
    ],
    name: "revokePolicy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "uint256", name: "start", type: "uint256" },
      { internalType: "uint256", name: "end", type: "uint256" },
    ],
    name: "roleBalanceCheckpoints",
    outputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint64",
                name: "timestamp",
                type: "uint64",
              },
              {
                internalType: "uint64",
                name: "expiration",
                type: "uint64",
              },
              { internalType: "uint96", name: "quantity", type: "uint96" },
            ],
            internalType: "struct PolicyholderCheckpoints.Checkpoint[]",
            name: "_checkpoints",
            type: "tuple[]",
          },
        ],
        internalType: "struct PolicyholderCheckpoints.History",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
    ],
    name: "roleBalanceCheckpoints",
    outputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint64",
                name: "timestamp",
                type: "uint64",
              },
              {
                internalType: "uint64",
                name: "expiration",
                type: "uint64",
              },
              { internalType: "uint96", name: "quantity", type: "uint96" },
            ],
            internalType: "struct PolicyholderCheckpoints.Checkpoint[]",
            name: "_checkpoints",
            type: "tuple[]",
          },
        ],
        internalType: "struct PolicyholderCheckpoints.History",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
    ],
    name: "roleBalanceCheckpointsLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint8", name: "role", type: "uint8" },
    ],
    name: "roleExpiration",
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "uint256", name: "start", type: "uint256" },
      { internalType: "uint256", name: "end", type: "uint256" },
    ],
    name: "roleSupplyCheckpoints",
    outputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint64",
                name: "timestamp",
                type: "uint64",
              },
              {
                internalType: "uint96",
                name: "numberOfHolders",
                type: "uint96",
              },
              {
                internalType: "uint96",
                name: "totalQuantity",
                type: "uint96",
              },
            ],
            internalType: "struct SupplyCheckpoints.Checkpoint[]",
            name: "_checkpoints",
            type: "tuple[]",
          },
        ],
        internalType: "struct SupplyCheckpoints.History",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint8", name: "role", type: "uint8" }],
    name: "roleSupplyCheckpoints",
    outputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint64",
                name: "timestamp",
                type: "uint64",
              },
              {
                internalType: "uint96",
                name: "numberOfHolders",
                type: "uint96",
              },
              {
                internalType: "uint96",
                name: "totalQuantity",
                type: "uint96",
              },
            ],
            internalType: "struct SupplyCheckpoints.Checkpoint[]",
            name: "_checkpoints",
            type: "tuple[]",
          },
        ],
        internalType: "struct SupplyCheckpoints.History",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint8", name: "role", type: "uint8" }],
    name: "roleSupplyCheckpointsLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "safeTransferFrom",
    outputs: [],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "bytes", name: "", type: "bytes" },
    ],
    name: "safeTransferFrom",
    outputs: [],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract ILlamaPolicyMetadata",
        name: "llamaPolicyMetadataLogic",
        type: "address",
      },
      { internalType: "bytes", name: "config", type: "bytes" },
    ],
    name: "setAndInitializePolicyMetadata",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "bool", name: "", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      { internalType: "address", name: "policyholder", type: "address" },
      { internalType: "uint96", name: "quantity", type: "uint96" },
      { internalType: "uint64", name: "expiration", type: "uint64" },
    ],
    name: "setRoleHolder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bytes4", name: "selector", type: "bytes4" },
          {
            internalType: "contract ILlamaStrategy",
            name: "strategy",
            type: "address",
          },
        ],
        internalType: "struct PermissionData",
        name: "permissionData",
        type: "tuple",
      },
      { internalType: "bool", name: "hasPermission", type: "bool" },
    ],
    name: "setRolePermission",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes4", name: "interfaceId", type: "bytes4" }],
    name: "supportsInterface",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "role", type: "uint8" },
      {
        internalType: "RoleDescription",
        name: "description",
        type: "bytes32",
      },
    ],
    name: "updateRoleDescription",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
