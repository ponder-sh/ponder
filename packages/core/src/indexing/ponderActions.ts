import {
  Abi,
  Chain,
  Client,
  ContractFunctionConfig,
  GetBalanceParameters,
  GetBalanceReturnType,
  GetBytecodeParameters,
  GetBytecodeReturnType,
  GetStorageAtParameters,
  GetStorageAtReturnType,
  MulticallParameters,
  MulticallReturnType,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";
import {
  getBalance as viemGetBalance,
  getBytecode as viemGetBytecode,
  getStorageAt as viemGetStorageAt,
  multicall as viemMulticall,
  readContract as viemReadContract,
} from "viem/actions";

export const ponderActions =
  (getCurrentBlockNumber: () => bigint) =>
  <TChain extends Chain | undefined = Chain | undefined>(
    client: Client<Transport, TChain>
  ) => ({
    getBalance: (
      args: Omit<GetBalanceParameters, "blockTag" | "blockNumber">
    ): Promise<GetBalanceReturnType> =>
      viemGetBalance(client, {
        ...args,
        blockNumber: getCurrentBlockNumber(),
      }),
    getBytecode: (
      args: Omit<GetBytecodeParameters, "blockTag" | "blockNumber">
    ): Promise<GetBytecodeReturnType> =>
      viemGetBytecode(client, {
        ...args,
        blockNumber: getCurrentBlockNumber(),
      }),
    getStorageAt: (
      args: Omit<GetStorageAtParameters, "blockTag" | "blockNumber">
    ): Promise<GetStorageAtReturnType> =>
      viemGetStorageAt(client, {
        ...args,
        blockNumber: getCurrentBlockNumber(),
      }),
    multicall: <
      TContracts extends ContractFunctionConfig[],
      TAllowFailure extends boolean = true
    >(
      args: Omit<
        MulticallParameters<TContracts, TAllowFailure>,
        "blockTag" | "blockNumber"
      >
    ): Promise<MulticallReturnType<TContracts, TAllowFailure>> =>
      viemMulticall(client, {
        ...args,
        blockNumber: getCurrentBlockNumber(),
      }),
    readContract: <
      TAbi extends Abi | readonly unknown[],
      TFunctionName extends string
    >(
      args: Omit<
        ReadContractParameters<TAbi, TFunctionName>,
        "blockTag" | "blockNumber"
      >
    ): Promise<ReadContractReturnType<TAbi, TFunctionName>> =>
      viemReadContract(client, {
        ...args,
        blockNumber: getCurrentBlockNumber(),
      } as ReadContractParameters<TAbi, TFunctionName>),
  });
