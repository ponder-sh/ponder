import { ethers } from "ethers";

import type { Network } from "@/networks/base";

import { BaseSource, SourceKind } from "./base";

export class EvmSource implements BaseSource {
  kind = SourceKind.EVM;
  name: string;
  network: Network;
  address: string;
  abiFilePath: string;
  abiInterface: ethers.utils.Interface;
  startBlock: number;
  blockLimit: number;

  constructor(
    name: string,
    network: Network,
    address: string,
    abiFilePath: string,
    abiInterface: ethers.utils.Interface,
    startBlock = 0,
    blockLimit = 2000
  ) {
    this.name = name;
    this.network = network;
    this.address = address.toLowerCase();
    this.abiFilePath = abiFilePath;
    this.abiInterface = abiInterface;
    this.startBlock = startBlock;
    this.blockLimit = blockLimit;
  }
}
