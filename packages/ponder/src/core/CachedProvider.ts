import type { BlockTag, TransactionRequest } from "@ethersproject/providers";
import { ethers } from "ethers";
import type { Deferrable } from "ethers/lib/utils";

import type { CacheStore } from "@/stores/baseCacheStore";

export class CachedProvider extends ethers.providers.StaticJsonRpcProvider {
  cacheStore: CacheStore;

  constructor(
    cacheStore: CacheStore,
    url?: string | ethers.utils.ConnectionInfo | undefined,
    network?: ethers.providers.Networkish | undefined
  ) {
    super(url, network);
    this.cacheStore = cacheStore;
  }

  async call(
    transaction: Deferrable<TransactionRequest>,
    _blockTag?: BlockTag | Promise<BlockTag>
  ): Promise<string> {
    console.log({ transaction, _blockTag });

    const chainId = await transaction.chainId;
    if (!chainId) throw new Error(`Missing chainId in transaction request`);

    const blockTag = (await _blockTag)?.toString();
    if (!blockTag) throw new Error(`Missing blockTag in transaction request`);

    const address = await transaction.to;
    if (!address) throw new Error(`Missing address in transaction request`);

    const data = (await transaction.data)?.toString();
    if (!data) throw new Error(`Missing data in transaction request`);

    const callCacheKey = `${chainId}-${blockTag}-${address}-${data}`;

    console.log({ transaction, _blockTag, callCacheKey });

    return super.call(transaction, blockTag);
  }
}
