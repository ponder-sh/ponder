import type { BlockTag, TransactionRequest } from "@ethersproject/providers";
import { ethers } from "ethers";
import type { Deferrable } from "ethers/lib/utils";

import type { CacheStore } from "@/db/baseCacheStore";

import { stats } from "./stats";

export class CachedProvider extends ethers.providers.StaticJsonRpcProvider {
  chainId: number;
  cacheStore: CacheStore;

  constructor(
    cacheStore: CacheStore,
    url: string | ethers.utils.ConnectionInfo,
    chainId: number
  ) {
    super(url, chainId);
    this.chainId = chainId;
    this.cacheStore = cacheStore;
  }

  async call(
    transaction: Deferrable<TransactionRequest>,
    _blockTag?: BlockTag | Promise<BlockTag>
  ): Promise<string> {
    if (!_blockTag) throw new Error(`Missing blockTag in transaction request`);
    if (typeof _blockTag !== "number")
      throw new Error(`blockTag must be a number (a decimal block number)`);

    const address = await transaction.to;
    if (!address) throw new Error(`Missing address in transaction request`);

    const data = (await transaction.data)?.toString();
    if (!data) throw new Error(`Missing data in transaction request`);

    const contractCallKey = `${this.chainId}-${_blockTag}-${address}-${data}`;

    const cachedContractCall = await this.cacheStore.getContractCall(
      contractCallKey
    );

    if (!stats.contractCallStats[`${this.chainId}-${address}`]) {
      stats.contractCallStats[`${this.chainId}-${address}`] = {
        contractCallCacheHitCount: 0,
        contractCallTotalCount: 0,
      };
    }

    stats.contractCallStats[
      `${this.chainId}-${address}`
    ].contractCallTotalCount += 1;

    if (cachedContractCall) {
      stats.contractCallStats[
        `${this.chainId}-${address}`
      ].contractCallCacheHitCount += 1;

      return JSON.parse(cachedContractCall.result);
    }

    const result = await super.call(transaction, _blockTag);

    await this.cacheStore.upsertContractCall({
      key: contractCallKey,
      result: JSON.stringify(result),
    });

    return result;
  }
}
