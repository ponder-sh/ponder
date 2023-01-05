import { ethers } from "ethers";

declare module "abitype" {
  export interface Config {
    // TODO: Drop `BigNumber` once ethers supports `bigint` natively
    BigIntType: ethers.BigNumber;
    IntType: number;
  }
}

export type { ReadOnlyContract } from "./getContract";
