import type { ethers } from "ethers";

import type { Network } from "@/networks/buildNetworks";

import { BaseSource, SourceKind } from "./base";

type EvmSourceOptions = {
  name: string;
  network: Network;
  address: string;

  abiFilePath?: string;
  abi: any[];
  abiInterface: ethers.utils.Interface;

  startBlock?: number;
  endBlock?: number;
  blockLimit?: number;

  isIndexed?: boolean;
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
  endBlock?: number;
  blockLimit: number;

  isIndexed: boolean;

  constructor(options: EvmSourceOptions) {
    this.name = options.name;
    this.network = options.network;
    this.address = options.address.toLowerCase();

    this.abiFilePath = options.abiFilePath;
    this.abi = options.abi;
    this.abiInterface = options.abiInterface;

    this.startBlock = options.startBlock || 0;
    this.endBlock = options.endBlock;
    this.blockLimit = options.blockLimit || 50;

    this.isIndexed = options.isIndexed !== undefined ? options.isIndexed : true;
  }
}
