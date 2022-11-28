import type { ethers } from "ethers";

import type { Network } from "@/networks/base";

import { BaseSource, SourceKind } from "./base";

type EvmSourceOptions = {
  name: string;
  network: Network;
  address: string;

  abiFilePath?: string;
  abi: any[];
  abiInterface: ethers.utils.Interface;

  startBlock?: number;
  blockLimit?: number;
};

export class EvmSource implements BaseSource {
  kind = SourceKind.EVM;
  name: string;
  network: Network;
  address: string;

  abiFilePath?: string;
  abi: any[];
  abiInterface: ethers.utils.Interface;

  startBlock: number;
  blockLimit: number;

  constructor(options: EvmSourceOptions) {
    this.name = options.name;
    this.network = options.network;
    this.address = options.address.toLowerCase();

    this.abiFilePath = options.abiFilePath;
    this.abi = options.abi;
    this.abiInterface = options.abiInterface;

    this.startBlock = options.startBlock || 0;
    this.blockLimit = options.blockLimit || 1000;
  }
}
