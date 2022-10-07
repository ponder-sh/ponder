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
  startBlock: number;
  blockLimit: number;

  provider: ethers.providers.StaticJsonRpcProvider;
  contract: ethers.Contract;

  constructor(
    name: string,
    chainId: number,
    rpcUrl: string,
    address: string,
    abiFilePath: string,
    abiInterface: ethers.utils.Interface,
    startBlock = 0,
    pollingInterval = 1000,
    blockLimit = 2000
  ) {
    this.name = name;
    this.chainId = chainId;
    this.rpcUrl = rpcUrl;
    this.address = address.toLowerCase();
    this.abiFilePath = abiFilePath;
    this.abiInterface = abiInterface;
    this.startBlock = startBlock;
    this.blockLimit = blockLimit;

    const cachedProvider = providersByChainId[chainId];
    if (cachedProvider) {
      this.provider = cachedProvider;
    } else {
      const provider = new ethers.providers.StaticJsonRpcProvider(
        this.rpcUrl,
        this.chainId
      );
      provider.pollingInterval = pollingInterval;

      providersByChainId[chainId] = provider;
      this.provider = provider;
    }

    this.contract = new ethers.Contract(
      this.address,
      this.abiInterface,
      this.provider
    );
  }
}
