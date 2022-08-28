import { Bytes } from '../common/collections'
import { BigInt } from '../common/numbers'

// Most types from this namespace are direct mappings or adaptations from:
// https://github.com/streamingfast/proto-near/blob/develop/sf/near/codec/v1/codec.proto
export namespace near {
  export type CryptoHash = Bytes

  export type Account = string

  export type BlockHeight = bigint

  export type Balance = bigint

  export type Gas = bigint

  export type ShardId = bigint

  export type NumBlocks = bigint

  export type ProtocolVersion = number

  export type Payload = bigint

  export enum CurveKind {
    ED25519 = 0,
    SECP256K1 = 1,
  }

  export class Signature {
    constructor(public kind: CurveKind, public bytes: Bytes) {}
  }

  export class PublicKey {
    constructor(public kind: CurveKind, public bytes: Bytes) {}
  }

  export enum AccessKeyPermissionKind {
    FUNCTION_CALL = 0,
    FULL_ACCESS = 1,
  }

  export class FunctionCallPermission {
    constructor(
      public allowance: bigint,
      public receiverId: string,
      public methodNames: Array<string>,
    ) {}
  }

  export class FullAccessPermission {}

  export class AccessKeyPermissionValue {
    constructor(public kind: AccessKeyPermissionKind, public data: Payload) {}

    toFunctionCall(): FunctionCallPermission {
      assert(
        this.kind == AccessKeyPermissionKind.FUNCTION_CALL,
        "AccessKeyPermissionValue is not a 'FunctionCall'.",
      )
      return this.data as number
    }

    toFullAccess(): FullAccessPermission {
      assert(
        this.kind == AccessKeyPermissionKind.FULL_ACCESS,
        "AccessKeyPermissionValue is not a 'FullAccess'.",
      )
      return this.data as number
    }

    static fromFunctionCall(input: FunctionCallPermission): AccessKeyPermissionValue {
      return new AccessKeyPermissionValue(AccessKeyPermissionKind.FUNCTION_CALL, input)
    }

    static fromFullAccess(input: FullAccessPermission): AccessKeyPermissionValue {
      return new AccessKeyPermissionValue(AccessKeyPermissionKind.FULL_ACCESS, input)
    }
  }

  export class AccessKey {
    constructor(public nonce: bigint, public permission: AccessKeyPermissionValue) {}
  }

  export class DataReceiver {
    constructor(public dataId: CryptoHash, public receiverId: string) {}
  }

  export enum ActionKind {
    CREATE_ACCOUNT = 0,
    DEPLOY_CONTRACT = 1,
    FUNCTION_CALL = 2,
    TRANSFER = 3,
    STAKE = 4,
    ADD_KEY = 5,
    DELETE_KEY = 6,
    DELETE_ACCOUNT = 7,
  }

  export class CreateAccountAction {}

  export class DeployContractAction {
    constructor(public codeHash: Bytes) {}
  }

  export class FunctionCallAction {
    constructor(
      public methodName: string,
      public args: Bytes,
      public gas: bigint,
      public deposit: bigint,
    ) {}
  }

  export class TransferAction {
    constructor(public deposit: bigint) {}
  }

  export class StakeAction {
    constructor(public stake: Balance, public publicKey: PublicKey) {}
  }

  export class AddKeyAction {
    constructor(public publicKey: PublicKey, public accessKey: AccessKey) {}
  }

  export class DeleteKeyAction {
    constructor(public publicKey: PublicKey) {}
  }

  export class DeleteAccountAction {
    constructor(public beneficiaryId: Account) {}
  }

  export class ActionValue {
    constructor(public kind: ActionKind, public data: Payload) {}

    toCreateAccount(): CreateAccountAction {
      assert(
        this.kind == ActionKind.CREATE_ACCOUNT,
        "ActionValue is not a 'CreateAccount'.",
      )
      return this.data as number
    }

    toDeployContract(): DeployContractAction {
      assert(
        this.kind == ActionKind.DEPLOY_CONTRACT,
        "ActionValue is not a 'DeployContract'.",
      )
      return this.data as number
    }

    toFunctionCall(): FunctionCallAction {
      assert(
        this.kind == ActionKind.FUNCTION_CALL,
        "ActionValue is not a 'FunctionCall'.",
      )
      return this.data as number
    }

    toTransfer(): TransferAction {
      assert(this.kind == ActionKind.TRANSFER, "ActionValue is not a 'Transfer'.")
      return this.data as number
    }

    toStake(): StakeAction {
      assert(this.kind == ActionKind.STAKE, "ActionValue is not a 'Stake'.")
      return this.data as number
    }

    toAddKey(): AddKeyAction {
      assert(this.kind == ActionKind.ADD_KEY, "ActionValue is not a 'AddKey'.")
      return this.data as number
    }

    toDeleteKey(): DeleteKeyAction {
      assert(this.kind == ActionKind.DELETE_KEY, "ActionValue is not a 'DeleteKey'.")
      return this.data as number
    }

    toDeleteAccount(): DeleteAccountAction {
      assert(
        this.kind == ActionKind.DELETE_ACCOUNT,
        "ActionValue is not a 'DeleteAccount'.",
      )
      return this.data as number
    }

    static fromCreateAccount(input: CreateAccountAction): ActionValue {
      return new ActionValue(ActionKind.CREATE_ACCOUNT, input)
    }

    static fromDeployContract(input: DeployContractAction): ActionValue {
      return new ActionValue(ActionKind.DEPLOY_CONTRACT, input)
    }

    static fromFunctionCall(input: FunctionCallAction): ActionValue {
      return new ActionValue(ActionKind.FUNCTION_CALL, input)
    }

    static fromTransfer(input: TransferAction): ActionValue {
      return new ActionValue(ActionKind.TRANSFER, input)
    }

    static fromStake(input: StakeAction): ActionValue {
      return new ActionValue(ActionKind.STAKE, input)
    }

    static fromAddKey(input: AddKeyAction): ActionValue {
      return new ActionValue(ActionKind.ADD_KEY, input)
    }

    static fromDeleteKey(input: DeleteKeyAction): ActionValue {
      return new ActionValue(ActionKind.DELETE_KEY, input)
    }

    static fromDeleteAccount(input: DeleteAccountAction): ActionValue {
      return new ActionValue(ActionKind.DELETE_ACCOUNT, input)
    }
  }

  // We don't map ReceiptData
  export class ActionReceipt {
    constructor(
      // Receipt fields
      public predecessorId: string,
      public receiverId: string,
      public id: CryptoHash,

      // ReceiptAction fields
      public signerId: string,
      public signerPublicKey: PublicKey,
      public gasPrice: bigint,
      public outputDataReceivers: Array<DataReceiver>,
      public inputDataIds: Array<CryptoHash>,
      public actions: Array<ActionValue>,
    ) {}
  }

  export enum SuccessStatusKind {
    VALUE = 0,
    RECEIPT_ID = 1,
  }

  // Doesn't have Value suffix because it has
  // VALUE variant/kind, that would be confusing.
  export class SuccessStatus {
    constructor(public kind: SuccessStatusKind, public data: Payload) {}

    toValue(): Bytes {
      assert(this.kind == SuccessStatusKind.VALUE, "SuccessStatus is not a 'Value'.")
      return this.data as number
    }

    toReceiptId(): CryptoHash {
      assert(
        this.kind == SuccessStatusKind.RECEIPT_ID,
        "SuccessStatus is not a 'ReceiptId'.",
      )
      return this.data as number
    }

    static fromValue(input: Bytes): SuccessStatus {
      return new SuccessStatus(SuccessStatusKind.VALUE, input)
    }

    static fromReceiptId(input: CryptoHash): SuccessStatus {
      return new SuccessStatus(SuccessStatusKind.RECEIPT_ID, input)
    }
  }

  export enum Direction {
    LEFT = 0,
    RIGHT = 1,
  }

  export class MerklePathItem {
    constructor(public hash: CryptoHash, public direction: Direction) {}

    lt(other: MerklePathItem): boolean {
      abort("Less than operator isn't supported in MerklePathItem")
      return false
    }

    gt(other: MerklePathItem): boolean {
      abort("Greater than operator isn't supported in MerklePathItem")
      return false
    }

    toString(): string {
      return `{hash: ${this.hash.toString()}}, direction: ${this.direction.toString()}`
    }
  }

  export class MerklePath extends Array<MerklePathItem> {}

  export class ExecutionOutcome {
    constructor(
      public gasBurnt: bigint,
      public proof: MerklePath,
      public blockHash: CryptoHash,
      public id: CryptoHash,
      public logs: Array<string>,
      public receiptIds: Array<CryptoHash>,
      public tokensBurnt: bigint,
      public executorId: string,
      public status: SuccessStatus,
    ) {}
  }

  export class SlashedValidator {
    constructor(public account: Account, public isDoubleSign: bool) {}
  }

  export class BlockHeader {
    constructor(
      public height: BlockHeight,
      public prevHeight: BlockHeight, // Always zero when version < V3
      public blockOrdinal: NumBlocks, // Always zero when version < V3
      public epochId: CryptoHash,
      public nextEpochId: CryptoHash,
      public chunksIncluded: bigint,
      public hash: CryptoHash,
      public prevHash: CryptoHash,
      public timestampNanosec: bigint,
      public prevStateRoot: CryptoHash,
      public chunkReceiptsRoot: CryptoHash,
      public chunkHeadersRoot: CryptoHash,
      public chunkTxRoot: CryptoHash,
      public outcomeRoot: CryptoHash,
      public challengesRoot: CryptoHash,
      public randomValue: CryptoHash,
      public validatorProposals: Array<ValidatorStake>,
      public chunkMask: Array<bool>,
      public gasPrice: Balance,
      public totalSupply: Balance,
      public challengesResult: Array<SlashedValidator>,
      public lastFinalBlock: CryptoHash,
      public lastDsFinalBlock: CryptoHash,
      public nextBpHash: CryptoHash,
      public blockMerkleRoot: CryptoHash,
      public epochSyncDataHash: CryptoHash, // Always empty when version < V3
      public approvals: Array<Signature>, // Array<Option<Signature>>
      public signature: Signature,
      public latestProtocolVersion: ProtocolVersion,
    ) {}
  }

  export class ValidatorStake {
    constructor(
      public account: Account,
      public publicKey: PublicKey,
      public stake: Balance,
    ) {}
  }

  export class ChunkHeader {
    constructor(
      public encodedLength: bigint,
      public gasUsed: Gas,
      public gasLimit: Gas,
      public shardId: ShardId,
      public heightCreated: BlockHeight,
      public heightIncluded: BlockHeight,
      public chunkHash: CryptoHash,
      public signature: Signature,
      public prevBlockHash: CryptoHash,
      public prevStateRoot: CryptoHash,
      public encodedMerkleRoot: CryptoHash,
      public balanceBurnt: Balance,
      public outgoingReceiptsRoot: CryptoHash,
      public txRoot: CryptoHash,
      public validatorProposals: Array<ValidatorStake>,
    ) {}
  }

  export class Block {
    constructor(
      public author: Account,
      public header: BlockHeader,
      public chunks: Array<ChunkHeader>,
    ) {}
  }

  export class ReceiptWithOutcome {
    constructor(
      public outcome: ExecutionOutcome,
      public receipt: ActionReceipt,
      public block: Block,
    ) {}
  }
}
