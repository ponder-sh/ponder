import type { Prettify } from "@/types/utils.js";
import type {
  Abi,
  Chain,
  Client,
  ContractFunctionConfig,
  GetBalanceParameters,
  GetBalanceReturnType,
  GetBytecodeParameters,
  GetBytecodeReturnType,
  GetEnsNameParameters,
  GetEnsNameReturnType,
  GetStorageAtParameters,
  GetStorageAtReturnType,
  MulticallParameters,
  MulticallReturnType,
  PublicRpcSchema,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";

export type BlockOptions =
  | {
      cache?: undefined;
      blockNumber?: undefined;
    }
  | {
      cache: "immutable";
      blockNumber?: undefined;
    }
  | {
      cache?: undefined;
      blockNumber: bigint;
    };

export type PonderActions = {
  getBalance: (
    args: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> & BlockOptions,
  ) => Promise<GetBalanceReturnType>;
  getBytecode: (
    args: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> &
      BlockOptions,
  ) => Promise<GetBytecodeReturnType>;
  getStorageAt: (
    args: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> &
      BlockOptions,
  ) => Promise<GetStorageAtReturnType>;
  multicall: <
    TContracts extends ContractFunctionConfig[],
    TAllowFailure extends boolean = true,
  >(
    args: Omit<
      MulticallParameters<TContracts, TAllowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<MulticallReturnType<TContracts, TAllowFailure>>;
  readContract: <
    const TAbi extends Abi | readonly unknown[],
    TFunctionName extends string,
  >(
    args: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<ReadContractReturnType<TAbi, TFunctionName>>;
  getEnsName: (
    args: Omit<GetEnsNameParameters, "blockTag" | "blockNumber"> & BlockOptions,
  ) => Promise<GetEnsNameReturnType>;
};

export type ReadOnlyClient<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
> = Prettify<
  Client<transport, chain, undefined, PublicRpcSchema, PonderActions>
>;
