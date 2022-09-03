import { ethers } from "ethers";

import { BaseSource, SourceKind } from "./base";

const providersByChainId: Record<
  number,
  ethers.providers.StaticJsonRpcProvider | undefined
> = {};

export class EvmSource implements BaseSource {
  kind = SourceKind.EVM;
  name: string;
  chainId: number;
  rpcUrl: string;
  address: string;
  abiFilePath: string;
  abiInterface: ethers.utils.Interface;
  startBlock?: number;

  provider: ethers.providers.StaticJsonRpcProvider;
  contract: ethers.Contract;

  constructor(
    name: string,
    chainId: number,
    rpcUrl: string,
    address: string,
    abiFilePath: string,
    abiInterface: ethers.utils.Interface,
    startBlock?: number
  ) {
    this.name = name;
    this.chainId = chainId;
    this.rpcUrl = rpcUrl;
    this.address = address;
    this.abiFilePath = abiFilePath;
    this.abiInterface = abiInterface;
    this.startBlock = startBlock;

    const cachedProvider = providersByChainId[chainId];
    if (cachedProvider) {
      this.provider = cachedProvider;
    } else {
      this.provider = new ethers.providers.StaticJsonRpcProvider(
        this.rpcUrl,
        this.chainId
      );
    }

    this.contract = new ethers.Contract(
      this.address,
      this.abiInterface,
      this.provider
    );
  }
}
