import type { BlockTag, TransactionRequest } from "@ethersproject/providers";
import { ethers } from "ethers";
import type { Deferrable } from "ethers/lib/utils";

import type { Ponder } from "@/Ponder";

// This class extends the ethers provider and
// caches contract calls in the Ponder CacheStore.
export class CachedProvider extends ethers.providers.StaticJsonRpcProvider {
  chainId: number;
  ponder: Ponder;

  constructor(
    ponder: Ponder,
    url: string | ethers.utils.ConnectionInfo,
    chainId: number
  ) {
    super(url, chainId);
    this.chainId = chainId;
    this.ponder = ponder;
  }

  async call(
    transaction: Deferrable<TransactionRequest>,
    _blockTag?: BlockTag | Promise<BlockTag>
  ): Promise<string> {
    let blockTag: number;

    if (_blockTag) {
      if (typeof _blockTag !== "number") {
        throw new Error(`blockTag must be a number (a decimal block number)`);
      }
      blockTag = _blockTag;
    } else {
      blockTag = this.ponder.currentEventBlockTag;
    }

    const address = await transaction.to;
    if (!address) throw new Error(`Missing address in transaction request`);

    const data = (await transaction.data)?.toString();
    if (!data) throw new Error(`Missing data in transaction request`);

    const contractCallKey = `${this.chainId}-${blockTag}-${address}-${data}`;

    const cachedContractCall = await this.ponder.cacheStore.getContractCall(
      contractCallKey
    );

    if (cachedContractCall) {
      return JSON.parse(cachedContractCall.result);
    }

    const result = await super.call(transaction, _blockTag);

    await this.ponder.cacheStore.upsertContractCall({
      key: contractCallKey,
      result: JSON.stringify(result),
    });

    return result;
  }
}
