import '../common/eager_offset'
import { Bytes } from '../common/collections'

// Most types from this namespace are direct mappings or adaptations from:
// https://github.com/ChainSafe/firehose-arweave/blob/master/proto/sf/arweave/type/v1/type.proto
export namespace arweave {
  /**
   * A key-value pair for arbitrary metadata
   */
  export class Tag {
    constructor(public name: Bytes, public value: Bytes) {}
  }

  export class ProofOfAccess {
    constructor(
      public option: string,
      public txPath: Bytes,
      public dataPath: Bytes,
      public chunk: Bytes,
    ) {}
  }

  /**
   * An Arweave block.
   */
  export class Block {
    constructor(
      public timestamp: u64,
      public lastRetarget: u64,
      public height: u64,
      public indepHash: Bytes,
      public nonce: Bytes,
      public previousBlock: Bytes,
      public diff: Bytes,
      public hash: Bytes,
      public txRoot: Bytes,
      public txs: Bytes[],
      public walletList: Bytes,
      public rewardAddr: Bytes,
      public tags: Tag[],
      public rewardPool: Bytes,
      public weaveSize: Bytes,
      public blockSize: Bytes,
      public cumulativeDiff: Bytes,
      public hashListMerkle: Bytes,
      public poa: ProofOfAccess,
    ) {}
  }

  /**
   * An Arweave transaction
   */
  export class Transaction {
    constructor(
      public format: u32,
      public id: Bytes,
      public lastTx: Bytes,
      public owner: Bytes,
      public tags: Tag[],
      public target: Bytes,
      public quantity: Bytes,
      public data: Bytes,
      public dataSize: Bytes,
      public dataRoot: Bytes,
      public signature: Bytes,
      public reward: Bytes,
    ) {}
  }

  /**
   * An Arweave transaction with block ptr
   */
  export class TransactionWithBlockPtr {
    constructor(public tx: Transaction, public block: Block) {}
  }
}
