import { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

export interface BlockchainStore {
  setup(): Promise<void>;

  // // Event source service method.
  // getLogs(arg: {
  //   fromBlockTimestamp: number;
  //   toBlockTimestamp: number;
  //   chainId: number;
  //   address?: Address | Address[];
  //   topics?: (Hex | Hex[] | null)[];
  // }): Promise<Log[]>;

  // Unfinalized sync methods.
  insertUnfinalizedBlock(options: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }): Promise<void>;

  deleteUnfinalizedData(options: {
    chainId: number;
    fromBlockNumber: number;
  }): Promise<void>;

  finalizeData(options: {
    chainId: number;
    toBlockNumber: number;
  }): Promise<void>;

  // // Finalized sync methods.
  // getLogFilterCachedRanges(arg: {
  //   filterKey: string;
  // }): Promise<LogFilterCachedRange[]>;
  // insertLogFilterCachedRange(arg: {
  //   range: LogFilterCachedRange;
  // }): Promise<void>;
  // insertFinalizedLogs({ logs }: { logs: RpcLog[] }): Promise<void>;
  // insertFinalizedBlock({
  //   block,
  //   transactions,
  // }: {
  //   block: RpcBlock;
  //   transactions: RpcTransaction;
  // }): Promise<void>;

  // // Injected contract call methods.
  // upsertContractCall(contractCall: ContractCall): Promise<void>;
  // getContractCall(contractCallKey: string): Promise<ContractCall | null>;
}
