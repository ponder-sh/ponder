import { Bytes } from '../common/collections'

export namespace cosmos {
  export class Block {
    constructor(
      public header: Header,
      public evidence: EvidenceList,
      public lastCommit: Commit,
      public resultBeginBlock: ResponseBeginBlock,
      public resultEndBlock: ResponseEndBlock,
      public transactions: Array<TxResult>,
      public validatorUpdates: Array<Validator>,
    ) {}
  }

  export class HeaderOnlyBlock {
    constructor(public header: Header) {}
  }

  export class EventData {
    constructor(public event: Event, public block: HeaderOnlyBlock) {}
  }

  export class TransactionData {
    constructor(public tx: TxResult, public block: HeaderOnlyBlock) {}
  }

  export class Header {
    constructor(
      public version: Consensus,
      public chainId: string,
      public height: bigint,
      public time: Timestamp,
      public lastBlockId: BlockID,
      public lastCommitHash: Bytes,
      public dataHash: Bytes,
      public validatorsHash: Bytes,
      public nextValidatorsHash: Bytes,
      public consensusHash: Bytes,
      public appHash: Bytes,
      public lastResultsHash: Bytes,
      public evidenceHash: Bytes,
      public proposerAddress: Bytes,
      public hash: Bytes,
    ) {}
  }

  export class Consensus {
    constructor(public block: bigint, public app: bigint) {}
  }

  export class Timestamp {
    constructor(public seconds: bigint, public nanos: number) {}
  }

  export class BlockID {
    constructor(public hash: Bytes, public partSetHeader: PartSetHeader) {}
  }

  export class PartSetHeader {
    constructor(public total: number, public hash: Bytes) {}
  }

  export class EvidenceList {
    constructor(public evidence: Array<Evidence>) {}
  }

  export class Evidence {
    constructor(
      public duplicateVoteEvidence: DuplicateVoteEvidence,
      public lightClientAttackEvidence: LightClientAttackEvidence,
    ) {}
  }

  export class DuplicateVoteEvidence {
    constructor(
      public voteA: EventVote,
      public voteB: EventVote,
      public totalVotingPower: bigint,
      public validatorPower: bigint,
      public timestamp: Timestamp,
    ) {}
  }

  export class EventVote {
    constructor(
      public eventVoteType: SignedMsgType,
      public height: bigint,
      public round: number,
      public blockId: BlockID,
      public timestamp: Timestamp,
      public validatorAddress: Bytes,
      public validatorIndex: number,
      public signature: Bytes,
    ) {}
  }

  export enum SignedMsgType {
    SIGNED_MSG_TYPE_UNKNOWN = 0,
    SIGNED_MSG_TYPE_PREVOTE = 1,
    SIGNED_MSG_TYPE_PRECOMMIT = 2,
    SIGNED_MSG_TYPE_PROPOSAL = 32,
  }

  export class LightClientAttackEvidence {
    constructor(
      public conflictingBlock: LightBlock,
      public commonHeight: bigint,
      public byzantineValidators: Array<Validator>,
      public totalVotingPower: bigint,
      public timestamp: Timestamp,
    ) {}
  }

  export class LightBlock {
    constructor(public signedHeader: SignedHeader, public validatorSet: ValidatorSet) {}
  }

  export class SignedHeader {
    constructor(public header: Header, public commit: Commit) {}
  }

  export class Commit {
    constructor(
      public height: bigint,
      public round: number,
      public blockId: BlockID,
      public signatures: Array<CommitSig>,
    ) {}
  }

  export class CommitSig {
    constructor(
      public blockIdFlag: BlockIDFlag,
      public validatorAddress: Bytes,
      public timestamp: Timestamp,
      public signature: Bytes,
    ) {}
  }

  export enum BlockIDFlag {
    BLOCK_ID_FLAG_UNKNOWN = 0,
    BLOCK_ID_FLAG_ABSENT = 1,
    BLOCK_ID_FLAG_COMMIT = 2,
    BLOCK_ID_FLAG_NIL = 3,
  }

  export class ValidatorSet {
    constructor(
      public validators: Array<Validator>,
      public proposer: Validator,
      public totalVotingPower: bigint,
    ) {}
  }

  export class Validator {
    constructor(
      public address: Bytes,
      public pubKey: PublicKey,
      public votingPower: bigint,
      public proposerPriority: bigint,
    ) {}
  }

  export class PublicKey {
    constructor(public ed25519: Bytes, public secp256k1: Bytes) {}
  }

  export class ResponseBeginBlock {
    constructor(public events: Array<Event>) {}
  }

  export class Event {
    constructor(public eventType: string, public attributes: Array<EventAttribute>) {}

    getAttribute(key: string): EventAttribute | null {
      for (let i = 0; i < this.attributes.length; i++) {
        if (this.attributes[i].key == key) {
          return this.attributes[i]
        }
      }
      return null
    }

    getAttributeValue(key: string): string {
      const attribute = this.getAttribute(key)
      return attribute ? attribute.value : ''
    }
  }

  export class EventAttribute {
    constructor(public key: string, public value: string, public index: bool) {}
  }

  export class ResponseEndBlock {
    constructor(
      public validatorUpdates: Array<ValidatorUpdate>,
      public consensusParamUpdates: ConsensusParams,
      public events: Array<Event>,
    ) {}
  }

  export class ValidatorUpdate {
    constructor(public address: Bytes, public pubKey: PublicKey, public power: bigint) {}
  }

  export class ConsensusParams {
    constructor(
      public block: BlockParams,
      public evidence: EvidenceParams,
      public validator: ValidatorParams,
      public version: VersionParams,
    ) {}
  }

  export class BlockParams {
    constructor(public maxBytes: bigint, public maxGas: bigint) {}
  }

  export class EvidenceParams {
    constructor(
      public maxAgeNumBlocks: bigint,
      public maxAgeDuration: Duration,
      public maxBytes: bigint,
    ) {}
  }

  export class Duration {
    constructor(public seconds: bigint, public nanos: number) {}
  }

  export class ValidatorParams {
    constructor(public pubKeyTypes: Array<string>) {}
  }

  export class VersionParams {
    constructor(public appVersion: bigint) {}
  }

  export class TxResult {
    constructor(
      public height: bigint,
      public index: number,
      public tx: Tx,
      public result: ResponseDeliverTx,
      public hash: Bytes,
    ) {}
  }

  export class Tx {
    constructor(
      public body: TxBody,
      public authInfo: AuthInfo,
      public signatures: Array<Bytes>,
    ) {}
  }

  export class TxBody {
    constructor(
      public messages: Array<Any>,
      public memo: string,
      public timeoutHeight: bigint,
      public extensionOptions: Array<Any>,
      public nonCriticalExtensionOptions: Array<Any>,
    ) {}
  }

  export class Any {
    constructor(public typeUrl: string, public value: Bytes) {}
  }

  export class AuthInfo {
    constructor(
      public signerInfos: Array<SignerInfo>,
      public fee: Fee,
      public tip: Tip,
    ) {}
  }

  export class SignerInfo {
    constructor(
      public publicKey: Any,
      public modeInfo: ModeInfo,
      public sequence: bigint,
    ) {}
  }

  export class ModeInfo {
    constructor(public single: ModeInfoSingle, public multi: ModeInfoMulti) {}
  }

  export class ModeInfoSingle {
    constructor(public mode: SignMode) {}
  }

  export enum SignMode {
    SIGN_MODE_UNSPECIFIED = 0,
    SIGN_MODE_DIRECT = 1,
    SIGN_MODE_TEXTUAL = 2,
    SIGN_MODE_LEGACY_AMINO_JSON = 127,
  }

  export class ModeInfoMulti {
    constructor(public bitarray: CompactBitArray, public modeInfos: Array<ModeInfo>) {}
  }

  export class CompactBitArray {
    constructor(public extraBitsStored: number, public elems: Bytes) {}
  }

  export class Fee {
    constructor(
      public amount: Array<Coin>,
      public gasLimit: bigint,
      public payer: string,
      public granter: string,
    ) {}
  }

  export class Coin {
    constructor(public denom: string, public amount: string) {}
  }

  export class Tip {
    constructor(public amount: Array<Coin>, public tipper: string) {}
  }

  export class ResponseDeliverTx {
    constructor(
      public code: number,
      public data: Bytes,
      public log: string,
      public info: string,
      public gasWanted: bigint,
      public gasUsed: bigint,
      public events: Array<Event>,
      public codespace: string,
    ) {}
  }

  export class ValidatorSetUpdates {
    constructor(public validatorUpdates: Array<Validator>) {}
  }
}
