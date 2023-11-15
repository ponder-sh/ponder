export const RouterImplAbi = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "CreateFail",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum IAstariaRouter.CollateralStates",
        name: "",
        type: "uint8",
      },
    ],
    name: "InvalidCollateralState",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum IAstariaRouter.CommitmentState",
        name: "",
        type: "uint8",
      },
    ],
    name: "InvalidCommitmentState",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "InvalidEpochLength",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidFileData",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum IAstariaRouter.LienState",
        name: "",
        type: "uint8",
      },
    ],
    name: "InvalidLienState",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum ILienToken.InvalidLienStates",
        name: "",
        type: "uint8",
      },
    ],
    name: "InvalidLienState",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "InvalidRefinanceDuration",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "InvalidRefinanceRate",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum IVaultImplementation.InvalidRequestReason",
        name: "reason",
        type: "uint8",
      },
    ],
    name: "InvalidRequest",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidSender",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "InvalidSenderForCollateral",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "",
        type: "uint16",
      },
    ],
    name: "InvalidStrategy",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "InvalidUnderlying",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "InvalidVault",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidVaultFee",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum IAstariaRouter.VaultState",
        name: "",
        type: "uint8",
      },
    ],
    name: "InvalidVaultState",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum IPublicVault.InvalidVaultStates",
        name: "",
        type: "uint8",
      },
    ],
    name: "InvalidVaultState",
    type: "error",
  },
  {
    inputs: [],
    name: "MaxAmountError",
    type: "error",
  },
  {
    inputs: [],
    name: "MaxSharesError",
    type: "error",
  },
  {
    inputs: [],
    name: "MinAmountError",
    type: "error",
  },
  {
    inputs: [],
    name: "MinSharesError",
    type: "error",
  },
  {
    inputs: [],
    name: "StrategyExpired",
    type: "error",
  },
  {
    inputs: [],
    name: "UnsupportedFile",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: true,
        internalType: "contract Authority",
        name: "newAuthority",
        type: "address",
      },
    ],
    name: "AuthorityUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "enum IAstariaRouter.FileType",
        name: "what",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "data",
        type: "bytes",
      },
    ],
    name: "FileUpdated",
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
        internalType: "uint256",
        name: "lienId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "liquidator",
        type: "address",
      },
    ],
    name: "Liquidation",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "strategist",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "delegate",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "vault",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "vaultType",
        type: "uint8",
      },
    ],
    name: "NewVault",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
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
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Paused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Unpaused",
    type: "event",
  },
  {
    stateMutability: "payable",
    type: "fallback",
  },
  {
    inputs: [],
    name: "BEACON_PROXY_IMPLEMENTATION",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "COLLATERAL_TOKEN",
    outputs: [
      {
        internalType: "contract ICollateralToken",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "LIEN_TOKEN",
    outputs: [
      {
        internalType: "contract ILienToken",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "STRATEGY_TYPEHASH",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "TRANSFER_PROXY",
    outputs: [
      {
        internalType: "contract ITransferProxy",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "WETH",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "__acceptGuardian",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "__emergencyPause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "__emergencyUnpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "__renounceGuardian",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "authority",
    outputs: [
      {
        internalType: "contract Authority",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint8",
                name: "collateralType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "address payable",
                name: "vault",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "collateralId",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "uint256",
                    name: "maxAmount",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "rate",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "duration",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "maxPotentialDebt",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "liquidationInitialAsk",
                    type: "uint256",
                  },
                ],
                internalType: "struct ILienToken.Details",
                name: "details",
                type: "tuple",
              },
            ],
            internalType: "struct ILienToken.Lien",
            name: "lien",
            type: "tuple",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "uint40",
                name: "last",
                type: "uint40",
              },
              {
                internalType: "uint40",
                name: "end",
                type: "uint40",
              },
            ],
            internalType: "struct ILienToken.Point",
            name: "point",
            type: "tuple",
          },
        ],
        internalType: "struct ILienToken.Stack",
        name: "stack",
        type: "tuple",
      },
    ],
    name: "canLiquidate",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "tokenContract",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "tokenId",
            type: "uint256",
          },
          {
            components: [
              {
                components: [
                  {
                    internalType: "uint8",
                    name: "version",
                    type: "uint8",
                  },
                  {
                    internalType: "uint256",
                    name: "deadline",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "vault",
                    type: "address",
                  },
                ],
                internalType: "struct IAstariaRouter.StrategyDetailsParam",
                name: "strategy",
                type: "tuple",
              },
              {
                internalType: "bytes",
                name: "nlrDetails",
                type: "bytes",
              },
              {
                internalType: "bytes32",
                name: "root",
                type: "bytes32",
              },
              {
                internalType: "bytes32[]",
                name: "proof",
                type: "bytes32[]",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "uint8",
                name: "v",
                type: "uint8",
              },
              {
                internalType: "bytes32",
                name: "r",
                type: "bytes32",
              },
              {
                internalType: "bytes32",
                name: "s",
                type: "bytes32",
              },
            ],
            internalType: "struct IAstariaRouter.NewLienRequest",
            name: "lienRequest",
            type: "tuple",
          },
        ],
        internalType: "struct IAstariaRouter.Commitment",
        name: "commitment",
        type: "tuple",
      },
    ],
    name: "commitToLien",
    outputs: [
      {
        internalType: "uint256",
        name: "lienId",
        type: "uint256",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "uint8",
                name: "collateralType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "address payable",
                name: "vault",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "collateralId",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "uint256",
                    name: "maxAmount",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "rate",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "duration",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "maxPotentialDebt",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "liquidationInitialAsk",
                    type: "uint256",
                  },
                ],
                internalType: "struct ILienToken.Details",
                name: "details",
                type: "tuple",
              },
            ],
            internalType: "struct ILienToken.Lien",
            name: "lien",
            type: "tuple",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "uint40",
                name: "last",
                type: "uint40",
              },
              {
                internalType: "uint40",
                name: "end",
                type: "uint40",
              },
            ],
            internalType: "struct ILienToken.Point",
            name: "point",
            type: "tuple",
          },
        ],
        internalType: "struct ILienToken.Stack",
        name: "stack",
        type: "tuple",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "minSharesOut",
        type: "uint256",
      },
    ],
    name: "deposit",
    outputs: [
      {
        internalType: "uint256",
        name: "sharesOut",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "minSharesOut",
        type: "uint256",
      },
    ],
    name: "depositMax",
    outputs: [
      {
        internalType: "uint256",
        name: "sharesOut",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "minSharesOut",
        type: "uint256",
      },
    ],
    name: "depositToVault",
    outputs: [
      {
        internalType: "uint256",
        name: "sharesOut",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "feeTo",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "enum IAstariaRouter.FileType",
            name: "what",
            type: "uint8",
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes",
          },
        ],
        internalType: "struct IAstariaRouter.File",
        name: "incoming",
        type: "tuple",
      },
    ],
    name: "file",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "enum IAstariaRouter.FileType",
            name: "what",
            type: "uint8",
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes",
          },
        ],
        internalType: "struct IAstariaRouter.File[]",
        name: "files",
        type: "tuple[]",
      },
    ],
    name: "fileBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "enum IAstariaRouter.FileType",
            name: "what",
            type: "uint8",
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes",
          },
        ],
        internalType: "struct IAstariaRouter.File[]",
        name: "file",
        type: "tuple[]",
      },
    ],
    name: "fileGuardian",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getAuctionWindow",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "implType",
        type: "uint8",
      },
    ],
    name: "getImpl",
    outputs: [
      {
        internalType: "address",
        name: "impl",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amountIn",
        type: "uint256",
      },
    ],
    name: "getLiquidatorFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amountIn",
        type: "uint256",
      },
    ],
    name: "getProtocolFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "tokenContract",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "tokenId",
            type: "uint256",
          },
          {
            components: [
              {
                components: [
                  {
                    internalType: "uint8",
                    name: "version",
                    type: "uint8",
                  },
                  {
                    internalType: "uint256",
                    name: "deadline",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "vault",
                    type: "address",
                  },
                ],
                internalType: "struct IAstariaRouter.StrategyDetailsParam",
                name: "strategy",
                type: "tuple",
              },
              {
                internalType: "bytes",
                name: "nlrDetails",
                type: "bytes",
              },
              {
                internalType: "bytes32",
                name: "root",
                type: "bytes32",
              },
              {
                internalType: "bytes32[]",
                name: "proof",
                type: "bytes32[]",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "uint8",
                name: "v",
                type: "uint8",
              },
              {
                internalType: "bytes32",
                name: "r",
                type: "bytes32",
              },
              {
                internalType: "bytes32",
                name: "s",
                type: "bytes32",
              },
            ],
            internalType: "struct IAstariaRouter.NewLienRequest",
            name: "lienRequest",
            type: "tuple",
          },
        ],
        internalType: "struct IAstariaRouter.Commitment",
        name: "commitment",
        type: "tuple",
      },
    ],
    name: "getStrategyValidator",
    outputs: [
      {
        internalType: "address",
        name: "strategyValidator",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract Authority",
        name: "_AUTHORITY",
        type: "address",
      },
      {
        internalType: "contract ICollateralToken",
        name: "_COLLATERAL_TOKEN",
        type: "address",
      },
      {
        internalType: "contract ILienToken",
        name: "_LIEN_TOKEN",
        type: "address",
      },
      {
        internalType: "contract ITransferProxy",
        name: "_TRANSFER_PROXY",
        type: "address",
      },
      {
        internalType: "address",
        name: "_VAULT_IMPL",
        type: "address",
      },
      {
        internalType: "address",
        name: "_SOLO_IMPL",
        type: "address",
      },
      {
        internalType: "address",
        name: "_WITHDRAW_IMPL",
        type: "address",
      },
      {
        internalType: "address",
        name: "_BEACON_PROXY_IMPL",
        type: "address",
      },
      {
        internalType: "address",
        name: "_WETH",
        type: "address",
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
        internalType: "address",
        name: "vault",
        type: "address",
      },
    ],
    name: "isValidVault",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint8",
                name: "collateralType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "address payable",
                name: "vault",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "collateralId",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "uint256",
                    name: "maxAmount",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "rate",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "duration",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "maxPotentialDebt",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "liquidationInitialAsk",
                    type: "uint256",
                  },
                ],
                internalType: "struct ILienToken.Details",
                name: "details",
                type: "tuple",
              },
            ],
            internalType: "struct ILienToken.Lien",
            name: "lien",
            type: "tuple",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "uint40",
                name: "last",
                type: "uint40",
              },
              {
                internalType: "uint40",
                name: "end",
                type: "uint40",
              },
            ],
            internalType: "struct ILienToken.Point",
            name: "point",
            type: "tuple",
          },
        ],
        internalType: "struct ILienToken.Stack",
        name: "stack",
        type: "tuple",
      },
    ],
    name: "liquidate",
    outputs: [
      {
        components: [
          {
            internalType: "address",
            name: "offerer",
            type: "address",
          },
          {
            internalType: "address",
            name: "zone",
            type: "address",
          },
          {
            components: [
              {
                internalType: "enum ItemType",
                name: "itemType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "startAmount",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endAmount",
                type: "uint256",
              },
            ],
            internalType: "struct OfferItem[]",
            name: "offer",
            type: "tuple[]",
          },
          {
            components: [
              {
                internalType: "enum ItemType",
                name: "itemType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "startAmount",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endAmount",
                type: "uint256",
              },
              {
                internalType: "address payable",
                name: "recipient",
                type: "address",
              },
            ],
            internalType: "struct ConsiderationItem[]",
            name: "consideration",
            type: "tuple[]",
          },
          {
            internalType: "enum OrderType",
            name: "orderType",
            type: "uint8",
          },
          {
            internalType: "uint256",
            name: "startTime",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "endTime",
            type: "uint256",
          },
          {
            internalType: "bytes32",
            name: "zoneHash",
            type: "bytes32",
          },
          {
            internalType: "uint256",
            name: "salt",
            type: "uint256",
          },
          {
            internalType: "bytes32",
            name: "conduitKey",
            type: "bytes32",
          },
          {
            internalType: "uint256",
            name: "totalOriginalConsiderationItems",
            type: "uint256",
          },
        ],
        internalType: "struct OrderParameters",
        name: "listedOrder",
        type: "tuple",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "maxAmountIn",
        type: "uint256",
      },
    ],
    name: "mint",
    outputs: [
      {
        internalType: "uint256",
        name: "amountIn",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes[]",
        name: "data",
        type: "bytes[]",
      },
    ],
    name: "multicall",
    outputs: [
      {
        internalType: "bytes[]",
        name: "results",
        type: "bytes[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epochLength",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "delegate",
        type: "address",
      },
      {
        internalType: "address",
        name: "underlying",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "vaultFee",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "allowListEnabled",
        type: "bool",
      },
      {
        internalType: "address[]",
        name: "allowList",
        type: "address[]",
      },
      {
        internalType: "uint256",
        name: "depositCap",
        type: "uint256",
      },
    ],
    name: "newPublicVault",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "delegate",
        type: "address",
      },
      {
        internalType: "address",
        name: "underlying",
        type: "address",
      },
    ],
    name: "newVault",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "recipient",
        type: "address",
      },
    ],
    name: "pullToken",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "minAmountOut",
        type: "uint256",
      },
    ],
    name: "redeem",
    outputs: [
      {
        internalType: "uint256",
        name: "amountOut",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IPublicVault",
        name: "vault",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "shares",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address",
      },
      {
        internalType: "uint64",
        name: "epoch",
        type: "uint64",
      },
    ],
    name: "redeemFutureEpoch",
    outputs: [
      {
        internalType: "uint256",
        name: "assets",
        type: "uint256",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "minAmountOut",
        type: "uint256",
      },
    ],
    name: "redeemMax",
    outputs: [
      {
        internalType: "uint256",
        name: "amountOut",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract Authority",
        name: "newAuthority",
        type: "address",
      },
    ],
    name: "setAuthority",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_guardian",
        type: "address",
      },
    ],
    name: "setNewGuardian",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "tokenContract",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "tokenId",
            type: "uint256",
          },
          {
            components: [
              {
                components: [
                  {
                    internalType: "uint8",
                    name: "version",
                    type: "uint8",
                  },
                  {
                    internalType: "uint256",
                    name: "deadline",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "vault",
                    type: "address",
                  },
                ],
                internalType: "struct IAstariaRouter.StrategyDetailsParam",
                name: "strategy",
                type: "tuple",
              },
              {
                internalType: "bytes",
                name: "nlrDetails",
                type: "bytes",
              },
              {
                internalType: "bytes32",
                name: "root",
                type: "bytes32",
              },
              {
                internalType: "bytes32[]",
                name: "proof",
                type: "bytes32[]",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "uint8",
                name: "v",
                type: "uint8",
              },
              {
                internalType: "bytes32",
                name: "r",
                type: "bytes32",
              },
              {
                internalType: "bytes32",
                name: "s",
                type: "bytes32",
              },
            ],
            internalType: "struct IAstariaRouter.NewLienRequest",
            name: "lienRequest",
            type: "tuple",
          },
        ],
        internalType: "struct IAstariaRouter.Commitment",
        name: "commitment",
        type: "tuple",
      },
    ],
    name: "validateCommitment",
    outputs: [
      {
        components: [
          {
            internalType: "uint8",
            name: "collateralType",
            type: "uint8",
          },
          {
            internalType: "address",
            name: "token",
            type: "address",
          },
          {
            internalType: "address payable",
            name: "vault",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "collateralId",
            type: "uint256",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "maxAmount",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "rate",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "duration",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "maxPotentialDebt",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "liquidationInitialAsk",
                type: "uint256",
              },
            ],
            internalType: "struct ILienToken.Details",
            name: "details",
            type: "tuple",
          },
        ],
        internalType: "struct ILienToken.Lien",
        name: "lien",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract IERC4626",
        name: "vault",
        type: "address",
      },
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "maxSharesOut",
        type: "uint256",
      },
    ],
    name: "withdraw",
    outputs: [
      {
        internalType: "uint256",
        name: "sharesOut",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    stateMutability: "payable",
    type: "receive",
  },
] as const;
