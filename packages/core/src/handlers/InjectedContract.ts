import type { BlockTag, TransactionRequest } from "@ethersproject/providers";
import { ethers } from "ethers";
import type { Deferrable } from "ethers/lib/utils";

import { CacheStore } from "@/database/cache/cacheStore";

import { EventHandlerService } from "./EventHandlerService";

// This class extends the ethers provider and
// caches contract calls in the Ponder CacheStore.
export class InjectedContract {
  chainId: number;
  cacheStore: CacheStore;
  eventHandlerService: EventHandlerService;

  constructor({
    eventHandlerService,
    cacheStore,
    url,
    chainId,
  }: {
    eventHandlerService: EventHandlerService;
    cacheStore: CacheStore;
    url: string | ethers.utils.ConnectionInfo;
    chainId: number;
  }) {
    this.chainId = chainId;
    this.cacheStore = cacheStore;
    this.eventHandlerService = eventHandlerService;
  }

  async call(
    transaction: Deferrable<TransactionRequest>,
    _blockTag?: BlockTag | Promise<BlockTag>
  ): Promise<string> {
    let blockTag: number | undefined;

    if (_blockTag) {
      if (typeof _blockTag !== "number") {
        throw new Error(`blockTag must be a number (an integer block number)`);
      }
      blockTag = _blockTag;
    } else {
      blockTag = this.eventHandlerService.currentLogEventBlockNumber;
    }

    const address = await transaction.to;
    if (!address) throw new Error(`Missing address in transaction request`);

    const data = (await transaction.data)?.toString();
    if (!data) throw new Error(`Missing data in transaction request`);

    const contractCallKey = `${this.chainId}-${blockTag}-${address}-${data}`;

    const cachedContractCall = await this.cacheStore.getContractCall(
      contractCallKey
    );

    if (cachedContractCall) {
      return JSON.parse(cachedContractCall.result);
    }

    const result = await super.call(transaction, blockTag);

    await this.cacheStore.upsertContractCall({
      key: contractCallKey,
      result: JSON.stringify(result),
    });

    return result;
  }
}
