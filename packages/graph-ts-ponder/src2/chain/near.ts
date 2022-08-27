import '../common/eager_offset'
import { Bytes } from '../common/collections'
import { BigInt } from '../common/numbers'

// Most types from this namespace are direct mappings or adaptations from:
// https://github.com/streamingfast/proto-near/blob/develop/sf/near/codec/v1/codec.proto
export namespace near {
  export type CryptoHash = Bytes

  export type Account = string

  export type BlockHeight = u64

  export type Balance = BigInt

  export type Gas = u64

  export type ShardId = u64

  export type NumBlocks = u64

  export type ProtocolVersion = u32

  export type Payload = u64

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
      public allowance: BigInt,
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
      return changetype<FunctionCallPermission>(this.data as u32)
    }

    toFullAccess(): FullAccessPermission {
      assert(
        this.kind == AccessKeyPermissionKind.FULL_ACCESS,
        "AccessKeyPermissionValue is not a 'FullAccess'.",
      )
      return changetype<FullAccessPermission>(this.data as u32)
    }

    static fromFunctionCall(input: FunctionCallPermission): AccessKeyPermissionValue {
      return new AccessKeyPermissionValue(
        AccessKeyPermissionKind.FUNCTION_CALL,
        changetype<u32>(input),
      )
    }

    static fromFullAccess(input: FullAccessPermission): AccessKeyPermissionValue {
      return new AccessKeyPermissionValue(
        AccessKeyPermissionKind.FULL_ACCESS,
        changetype<u32>(input),
      )
    }
  }

  export class AccessKey {
    constructor(public nonce: u64, public permission: AccessKeyPermissionValue) {}
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
      public gas: u64,
      public deposit: BigInt,
    ) {}
  }

  export class TransferAction {
    constructor(public deposit: BigInt) {}
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
      return changetype<CreateAccountAction>(this.data as u32)
    }

    toDeployContract(): DeployContractAction {
      assert(
        this.kind == ActionKind.DEPLOY_CONTRACT,
        "ActionValue is not a 'DeployContract'.",
      )
      return changetype<DeployContractAction>(this.data as u32)
    }

    toFunctionCall(): FunctionCallAction {
      assert(
        this.kind == ActionKind.FUNCTION_CALL,
        "ActionValue is not a 'FunctionCall'.",
      )
      return changetype<FunctionCallAction>(this.data as u32)
    }

    toTransfer(): TransferAction {
      assert(this.kind == ActionKind.TRANSFER, "ActionValue is not a 'Transfer'.")
      return changetype<TransferAction>(this.data as u32)
    }

    toStake(): StakeAction {
      assert(this.kind == ActionKind.STAKE, "ActionValue is not a 'Stake'.")
      return changetype<StakeAction>(this.data as u32)
    }

    toAddKey(): AddKeyAction {
      assert(this.kind == ActionKind.ADD_KEY, "ActionValue is not a 'AddKey'.")
      return changetype<AddKeyAction>(this.data as u32)
    }

    toDeleteKey(): DeleteKeyAction {
      assert(this.kind == ActionKind.DELETE_KEY, "ActionValue is not a 'DeleteKey'.")
      return changetype<DeleteKeyAction>(this.data as u32)
    }

    toDeleteAccount(): DeleteAccountAction {
      assert(
        this.kind == ActionKind.DELETE_ACCOUNT,
        "ActionValue is not a 'DeleteAccount'.",
      )
      return changetype<DeleteAccountAction>(this.data as u32)
    }

    static fromCreateAccount(input: CreateAccountAction): ActionValue {
      return new ActionValue(ActionKind.CREATE_ACCOUNT, changetype<u32>(input))
    }

    static fromDeployContract(input: DeployContractAction): ActionValue {
      return new ActionValue(ActionKind.DEPLOY_CONTRACT, changetype<u32>(input))
    }

    static fromFunctionCall(input: FunctionCallAction): ActionValue {
      return new ActionValue(ActionKind.FUNCTION_CALL, changetype<u32>(input))
    }

    static fromTransfer(input: TransferAction): ActionValue {
      return new ActionValue(ActionKind.TRANSFER, changetype<u32>(input))
    }

    static fromStake(input: StakeAction): ActionValue {
      return new ActionValue(ActionKind.STAKE, changetype<u32>(input))
    }

    static fromAddKey(input: AddKeyAction): ActionValue {
      return new ActionValue(ActionKind.ADD_KEY, changetype<u32>(input))
    }

    static fromDeleteKey(input: DeleteKeyAction): ActionValue {
      return new ActionValue(ActionKind.DELETE_KEY, changetype<u32>(input))
    }

    static fromDeleteAccount(input: DeleteAccountAction): ActionValue {
      return new ActionValue(ActionKind.DELETE_ACCOUNT, changetype<u32>(input))
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
      public gasPrice: BigInt,
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
      return changetype<Bytes>(this.data as u32)
    }

    toReceiptId(): CryptoHash {
      assert(
        this.kind == SuccessStatusKind.RECEIPT_ID,
        "SuccessStatus is not a 'ReceiptId'.",
      )
      return changetype<CryptoHash>(this.data as u32)
    }

    static fromValue(input: Bytes): SuccessStatus {
      return new SuccessStatus(SuccessStatusKind.VALUE, changetype<u32>(input))
    }

    static fromReceiptId(input: CryptoHash): SuccessStatus {
      return new SuccessStatus(SuccessStatusKind.RECEIPT_ID, changetype<u32>(input))
    }
  }

  export enum Direction {
    LEFT = 0,
    RIGHT = 1,
  }

  export class MerklePathItem {
    constructor(public hash: CryptoHash, public direction: Direction) {}

    @operator('<')
    lt(other: MerklePathItem): boolean {
      abort("Less than operator isn't supported in MerklePathItem")
      return false
    }

    @operator('>')
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
      public gasBurnt: u64,
      public proof: MerklePath,
      public blockHash: CryptoHash,
      public id: CryptoHash,
      public logs: Array<string>,
      public receiptIds: Array<CryptoHash>,
      public tokensBurnt: BigInt,
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
      public chunksIncluded: u64,
      public hash: CryptoHash,
      public prevHash: CryptoHash,
      public timestampNanosec: u64,
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
      public encodedLength: u64,
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
