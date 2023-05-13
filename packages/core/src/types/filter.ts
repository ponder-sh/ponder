import { Address, Hex } from "viem";

export type LogFilter = {
  addresses: Address[] | undefined;
  topics: (Hex | Hex[] | null)[] | undefined;
  fromBlock: number | undefined;
  toBlock: number | undefined;
};
