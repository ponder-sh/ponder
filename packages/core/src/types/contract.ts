import { Abi, Address, ExtractAbiFunctionNames } from "abitype";
import { GetContractReturnType, PublicClient } from "viem";

export type ReadOnlyContract<
  TAbi extends Abi = Abi,
  _ReadFunctionNames extends string = TAbi extends Abi
    ? Abi extends TAbi
      ? string
      : ExtractAbiFunctionNames<TAbi, "pure" | "view">
    : string
> = GetContractReturnType<
  TAbi,
  PublicClient,
  unknown,
  Address,
  never,
  _ReadFunctionNames,
  never
>;
