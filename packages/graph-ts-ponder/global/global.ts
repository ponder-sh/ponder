import { BigDecimal } from '../common/numbers'
import {
  Bytes,
  TypedMapEntry,
  Entity,
  TypedMap,
  Result,
  Wrapped,
} from '../common/collections'
import { JSONValue, Value } from '../common/value'
import { arweave } from '../chain/arweave'
import { ethereum } from '../chain/ethereum'
import { near } from '../chain/near'
import { cosmos } from '../chain/cosmos'

/**
 * Contains type IDs and their discriminants for every blockchain supported by Graph-Node.
 *
 * Each variant corresponds to the unique ID of an AssemblyScript concrete class used by
 * Graph-Node's runtime.
 *
 * # Rules for updating this enum
 *
 * 1. The discriminants must have the same value as their counterparts in `IndexForAscTypeId` enum
 *    from `graph-node`'s `graph::runtime` module. If not, the runtime will fail to determine the
 *    correct class during allocation.
 * 2. Each supported blockchain has a reserved space of 1,000 * contiguous variants.
 * 3. Once defined, items and their discriminants cannot be changed, as this would break running
 *    subgraphs compiled in previous versions of this representation.
 */
export enum TypeId {
  String = 0,
  ArrayBuffer = 1,
  Int8Array = 2,
  Int16Array = 3,
  Int32Array = 4,
  Int64Array = 5,
  Uint8Array = 6,
  Uint16Array = 7,
  Uint32Array = 8,
  Uint64Array = 9,
  Float32Array = 10,
  Float64Array = 11,
  BigDecimal = 12,
  ArrayBool = 13,
  ArrayUint8Array = 14,
  ArrayEthereumValue = 15,
  ArrayStoreValue = 16,
  ArrayJsonValue = 17,
  ArrayString = 18,
  ArrayEventParam = 19,
  ArrayTypedMapEntryStringJsonValue = 20,
  ArrayTypedMapEntryStringStoreValue = 21,
  SmartContractCall = 22,
  EventParam = 23,
  EthereumTransaction = 24,
  EthereumBlock = 25,
  EthereumCall = 26,
  WrappedTypedMapStringJsonValue = 27,
  WrappedBool = 28,
  WrappedJsonValue = 29,
  EthereumValue = 30,
  StoreValue = 31,
  JsonValue = 32,
  EthereumEvent = 33,
  TypedMapEntryStringStoreValue = 34,
  TypedMapEntryStringJsonValue = 35,
  TypedMapStringStoreValue = 36,
  TypedMapStringJsonValue = 37,
  TypedMapStringTypedMapStringJsonValue = 38,
  ResultTypedMapStringJsonValueBool = 39,
  ResultJsonValueBool = 40,
  ArrayU8 = 41,
  ArrayU16 = 42,
  ArrayU32 = 43,
  ArrayU64 = 44,
  ArrayI8 = 45,
  ArrayI16 = 46,
  ArrayI32 = 47,
  ArrayI64 = 48,
  ArrayF32 = 49,
  ArrayF64 = 50,
  ArrayBigDecimal = 51,

  // Near types
  NearArrayDataReceiver = 52,
  NearArrayCryptoHash = 53,
  NearArrayActionValue = 54,
  NearMerklePath = 55, // or NearArrayMerklePathItem
  NearArrayValidatorStake = 56,
  NearArraySlashedValidator = 57,
  NearArraySignature = 58,
  NearArrayChunkHeader = 59,
  NearAccessKeyPermissionValue = 60,
  NearActionValue = 61,
  NearDirection = 62, // not used in graph-node anymore. Can be ignored.
  NearPublicKey = 63,
  NearSignature = 64,
  NearFunctionCallPermission = 65,
  NearFullAccessPermission = 66,
  NearAccessKey = 67,
  NearDataReceiver = 68,
  NearCreateAccountAction = 69,
  NearDeployContractAction = 70,
  NearFunctionCallAction = 71,
  NearTransferAction = 72,
  NearStakeAction = 73,
  NearAddKeyAction = 74,
  NearDeleteKeyAction = 75,
  NearDeleteAccountAction = 76,
  NearActionReceipt = 77,
  NearSuccessStatus = 78,
  NearMerklePathItem = 79,
  NearExecutionOutcome = 80,
  NearSlashedValidator = 81,
  NearBlockHeader = 82,
  NearValidatorStake = 83,
  NearChunkHeader = 84,
  NearBlock = 85,
  NearReceiptWithOutcome = 86,
  /*
  Reserved discriminant space for more Near type IDs: [87, 999]:
  Continue to add more Near type IDs here. e.g.:
  ```
  NextNearType = 87,
  AnotherNearType = 88,
  ...
  LastNearType = 999,
  ```
  */

  // Reserved discriminant space for more Ethereum type IDs: [1000, 1499]
  TransactionReceipt = 1000,
  Log = 1001,
  ArrayH256 = 1002,
  ArrayLog = 1003,
  /*
  Continue to add more Ethereum type IDs here. e.g.:
  ```
  NextEthereumType = 1004,
  AnotherEthereumType = 1005,
  ...
  LastEthereumType = 1499,
  ```
  */

  // Reserved discriminant space for Cosmos type IDs: [1,500, 2,499]
  CosmosAny = 1500,
  CosmosArrayAny = 1501,
  CosmosArrayBytes = 1502,
  CosmosArrayCoin = 1503,
  CosmosArrayCommitSig = 1504,
  CosmosArrayEvent = 1505,
  CosmosArrayEventAttribute = 1506,
  CosmosArrayEvidence = 1507,
  CosmosArrayModeInfo = 1508,
  CosmosArraySignerInfo = 1509,
  CosmosArrayTxResult = 1510,
  CosmosArrayValidator = 1511,
  CosmosArrayValidatorUpdate = 1512,
  CosmosAuthInfo = 1513,
  CosmosBlock = 1514,
  CosmosBlockID = 1515,
  CosmosBlockIDFlagEnum = 1516,
  CosmosBlockParams = 1517,
  CosmosCoin = 1518,
  CosmosCommit = 1519,
  CosmosCommitSig = 1520,
  CosmosCompactBitArray = 1521,
  CosmosConsensus = 1522,
  CosmosConsensusParams = 1523,
  CosmosDuplicateVoteEvidence = 1524,
  CosmosDuration = 1525,
  CosmosEvent = 1526,
  CosmosEventAttribute = 1527,
  CosmosEventData = 1528,
  CosmosEventVote = 1529,
  CosmosEvidence = 1530,
  CosmosEvidenceList = 1531,
  CosmosEvidenceParams = 1532,
  CosmosFee = 1533,
  CosmosHeader = 1534,
  CosmosHeaderOnlyBlock = 1535,
  CosmosLightBlock = 1536,
  CosmosLightClientAttackEvidence = 1537,
  CosmosModeInfo = 1538,
  CosmosModeInfoMulti = 1539,
  CosmosModeInfoSingle = 1540,
  CosmosPartSetHeader = 1541,
  CosmosPublicKey = 1542,
  CosmosResponseBeginBlock = 1543,
  CosmosResponseDeliverTx = 1544,
  CosmosResponseEndBlock = 1545,
  CosmosSignModeEnum = 1546,
  CosmosSignedHeader = 1547,
  CosmosSignedMsgTypeEnum = 1548,
  CosmosSignerInfo = 1549,
  CosmosTimestamp = 1550,
  CosmosTip = 1551,
  CosmosTransactionData = 1552,
  CosmosTx = 1553,
  CosmosTxBody = 1554,
  CosmosTxResult = 1555,
  CosmosValidator = 1556,
  CosmosValidatorParams = 1557,
  CosmosValidatorSet = 1558,
  CosmosValidatorSetUpdates = 1559,
  CosmosValidatorUpdate = 1560,
  CosmosVersionParams = 1561,
  /*
  Continue to add more Cosmos type IDs here. e.g.:
  ```
  NextCosmosType = 1562,
  AnotherCosmosType = 1563,
  ...
  LastCosmosType = 2499,
  ```
  */

  // Reserved discriminant space for Tendermint type IDs: [2,500, 3,499]
  ArweaveBlock = 2500,
  ArweaveProofOfAccess = 2501,
  ArweaveTag = 2502,
  ArweaveTagArray = 2503,
  ArweaveTransaction = 2504,
  ArweaveTransactionArray = 2505,
  ArweaveTransactionWithBlockPtr = 2506,
  /*
  Continue to add more Arweave type IDs here. e.g.:
  ```
  NextArweaveType = 2507,
  AnotherArweaveType = 2508,
  ...
  LastArweaveType = 3499,
  ```
  */

  // Reserved discriminant space for a future blockchain type IDs: [3,500, 4,499]
}

export function id_of_type(typeId: TypeId): usize {
  switch (typeId) {
    case TypeId.String:
      return idof<string>()
    case TypeId.ArrayBuffer:
      return idof<ArrayBuffer>()
    case TypeId.Int8Array:
      return idof<Int8Array>()
    case TypeId.Int16Array:
      return idof<Int16Array>()
    case TypeId.Int32Array:
      return idof<Int32Array>()
    case TypeId.Int64Array:
      return idof<Int64Array>()
    case TypeId.Uint8Array:
      return idof<Uint8Array>()
    case TypeId.Uint16Array:
      return idof<Uint16Array>()
    case TypeId.Uint32Array:
      return idof<Uint32Array>()
    case TypeId.Uint64Array:
      return idof<Uint64Array>()
    case TypeId.Float32Array:
      return idof<Float32Array>()
    case TypeId.Float64Array:
      return idof<Float64Array>()
    case TypeId.BigDecimal:
      return idof<BigDecimal>()
    case TypeId.ArrayBool:
      return idof<Array<bool>>()
    case TypeId.ArrayUint8Array:
      return idof<Array<Uint8Array>>()
    case TypeId.ArrayEthereumValue:
      return idof<Array<ethereum.Value>>()
    case TypeId.ArrayStoreValue:
      return idof<Array<Value>>()
    case TypeId.ArrayJsonValue:
      return idof<Array<JSONValue>>()
    case TypeId.ArrayString:
      return idof<Array<string>>()
    case TypeId.ArrayEventParam:
      return idof<Array<ethereum.EventParam>>()
    case TypeId.ArrayTypedMapEntryStringJsonValue:
      return idof<Array<TypedMapEntry<string, JSONValue>>>()
    case TypeId.ArrayTypedMapEntryStringStoreValue:
      return idof<Array<Entity>>()
    case TypeId.WrappedTypedMapStringJsonValue:
      return idof<Wrapped<TypedMapEntry<string, JSONValue>>>()
    case TypeId.WrappedBool:
      return idof<Wrapped<boolean>>()
    case TypeId.WrappedJsonValue:
      return idof<Wrapped<JSONValue>>()
    case TypeId.SmartContractCall:
      return idof<ethereum.SmartContractCall>()
    case TypeId.EventParam:
      return idof<ethereum.EventParam>()
    case TypeId.EthereumTransaction:
      return idof<ethereum.Transaction>()
    case TypeId.EthereumBlock:
      return idof<ethereum.Block>()
    case TypeId.EthereumCall:
      return idof<ethereum.Call>()
    case TypeId.EthereumValue:
      return idof<ethereum.Value>()
    case TypeId.StoreValue:
      return idof<Value>()
    case TypeId.JsonValue:
      return idof<JSONValue>()
    case TypeId.EthereumEvent:
      return idof<ethereum.Event>()
    case TypeId.TypedMapEntryStringStoreValue:
      return idof<Entity>()
    case TypeId.TypedMapEntryStringJsonValue:
      return idof<TypedMap<string, JSONValue>>()
    case TypeId.TypedMapStringStoreValue:
      return idof<TypedMap<string, Value>>()
    case TypeId.TypedMapStringJsonValue:
      return idof<TypedMap<string, JSONValue>>()
    case TypeId.TypedMapStringTypedMapStringJsonValue:
      return idof<TypedMap<string, TypedMap<string, JSONValue>>>()
    case TypeId.ResultTypedMapStringJsonValueBool:
      return idof<Result<TypedMap<string, JSONValue>, boolean>>()
    case TypeId.ResultJsonValueBool:
      return idof<Result<JSONValue, boolean>>()
    case TypeId.ArrayU8:
      return idof<Array<u8>>()
    case TypeId.ArrayU16:
      return idof<Array<u16>>()
    case TypeId.ArrayU32:
      return idof<Array<u32>>()
    case TypeId.ArrayU64:
      return idof<Array<u64>>()
    case TypeId.ArrayI8:
      return idof<Array<i8>>()
    case TypeId.ArrayI16:
      return idof<Array<i16>>()
    case TypeId.ArrayI32:
      return idof<Array<i32>>()
    case TypeId.ArrayI64:
      return idof<Array<i64>>()
    case TypeId.ArrayF32:
      return idof<Array<f32>>()
    case TypeId.ArrayF64:
      return idof<Array<f64>>()
    case TypeId.ArrayBigDecimal:
      return idof<Array<BigDecimal>>()
    case TypeId.NearArrayDataReceiver:
      return idof<Array<near.DataReceiver>>()
    case TypeId.NearArrayCryptoHash:
      return idof<Array<near.CryptoHash>>()
    case TypeId.NearArrayActionValue:
      return idof<Array<near.ActionValue>>()
    case TypeId.NearMerklePath:
      return idof<near.MerklePath>()
    case TypeId.NearArrayValidatorStake:
      return idof<Array<near.ValidatorStake>>()
    case TypeId.NearArraySlashedValidator:
      return idof<Array<near.SlashedValidator>>()
    case TypeId.NearArraySignature:
      return idof<Array<near.Signature>>()
    case TypeId.NearArrayChunkHeader:
      return idof<Array<near.ChunkHeader>>()
    case TypeId.NearAccessKeyPermissionValue:
      return idof<near.AccessKeyPermissionValue>()
    case TypeId.NearActionValue:
      return idof<near.ActionValue>()
    // Commented out because it's an enum, there's no type_id
    // case TypeId.NearDirection:
    //   return idof<near.Direction>()
    case TypeId.NearPublicKey:
      return idof<near.PublicKey>()
    case TypeId.NearSignature:
      return idof<near.Signature>()
    case TypeId.NearFunctionCallPermission:
      return idof<near.FunctionCallPermission>()
    case TypeId.NearFullAccessPermission:
      return idof<near.FullAccessPermission>()
    case TypeId.NearAccessKey:
      return idof<near.AccessKeyPermissionValue>()
    case TypeId.NearDataReceiver:
      return idof<near.DataReceiver>()
    case TypeId.NearCreateAccountAction:
      return idof<near.CreateAccountAction>()
    case TypeId.NearDeployContractAction:
      return idof<near.DeployContractAction>()
    case TypeId.NearFunctionCallAction:
      return idof<near.FunctionCallAction>()
    case TypeId.NearTransferAction:
      return idof<near.TransferAction>()
    case TypeId.NearStakeAction:
      return idof<near.StakeAction>()
    case TypeId.NearAddKeyAction:
      return idof<near.AddKeyAction>()
    case TypeId.NearDeleteKeyAction:
      return idof<near.DeleteKeyAction>()
    case TypeId.NearDeleteAccountAction:
      return idof<near.DeleteAccountAction>()
    case TypeId.NearActionReceipt:
      return idof<near.ActionReceipt>()
    case TypeId.NearSuccessStatus:
      return idof<near.SuccessStatus>()
    case TypeId.NearMerklePathItem:
      return idof<near.MerklePathItem>()
    case TypeId.NearExecutionOutcome:
      return idof<near.ExecutionOutcome>()
    case TypeId.NearSlashedValidator:
      return idof<near.SlashedValidator>()
    case TypeId.NearBlockHeader:
      return idof<near.BlockHeader>()
    case TypeId.NearValidatorStake:
      return idof<near.ValidatorStake>()
    case TypeId.NearChunkHeader:
      return idof<near.ChunkHeader>()
    case TypeId.NearBlock:
      return idof<near.Block>()
    case TypeId.NearReceiptWithOutcome:
      return idof<near.ReceiptWithOutcome>()
    case TypeId.TransactionReceipt:
      return idof<ethereum.TransactionReceipt>()
    case TypeId.Log:
      return idof<ethereum.Log>()
    case TypeId.ArrayH256:
      return idof<Array<Uint8Array>>()
    case TypeId.ArrayLog:
      return idof<Array<ethereum.Log>>()
    case TypeId.CosmosAny:
      return idof<cosmos.Any>()
    case TypeId.CosmosArrayAny:
      return idof<Array<cosmos.Any>>()
    case TypeId.CosmosArrayBytes:
      return idof<Array<Bytes>>()
    case TypeId.CosmosArrayCoin:
      return idof<Array<cosmos.Coin>>()
    case TypeId.CosmosArrayCommitSig:
      return idof<Array<cosmos.CommitSig>>()
    case TypeId.CosmosArrayEvent:
      return idof<Array<cosmos.Event>>()
    case TypeId.CosmosArrayEventAttribute:
      return idof<Array<cosmos.EventAttribute>>()
    case TypeId.CosmosArrayEvidence:
      return idof<Array<cosmos.Evidence>>()
    case TypeId.CosmosArrayModeInfo:
      return idof<Array<cosmos.ModeInfo>>()
    case TypeId.CosmosArraySignerInfo:
      return idof<Array<cosmos.SignerInfo>>()
    case TypeId.CosmosArrayTxResult:
      return idof<Array<cosmos.TxResult>>()
    case TypeId.CosmosArrayValidator:
      return idof<Array<cosmos.Validator>>()
    case TypeId.CosmosArrayValidatorUpdate:
      return idof<Array<cosmos.ValidatorUpdate>>()
    case TypeId.CosmosAuthInfo:
      return idof<cosmos.AuthInfo>()
    case TypeId.CosmosBlock:
      return idof<cosmos.Block>()
    case TypeId.CosmosBlockID:
      return idof<cosmos.BlockID>()
    case TypeId.CosmosBlockIDFlagEnum:
      return idof<Array<cosmos.BlockIDFlag>>()
    case TypeId.CosmosBlockParams:
      return idof<cosmos.BlockParams>()
    case TypeId.CosmosCoin:
      return idof<cosmos.Coin>()
    case TypeId.CosmosCommit:
      return idof<cosmos.Commit>()
    case TypeId.CosmosCommitSig:
      return idof<cosmos.CommitSig>()
    case TypeId.CosmosCompactBitArray:
      return idof<cosmos.CompactBitArray>()
    case TypeId.CosmosConsensus:
      return idof<cosmos.Consensus>()
    case TypeId.CosmosConsensusParams:
      return idof<cosmos.ConsensusParams>()
    case TypeId.CosmosDuplicateVoteEvidence:
      return idof<cosmos.DuplicateVoteEvidence>()
    case TypeId.CosmosDuration:
      return idof<cosmos.Duration>()
    case TypeId.CosmosEvent:
      return idof<cosmos.Event>()
    case TypeId.CosmosEventAttribute:
      return idof<cosmos.EventAttribute>()
    case TypeId.CosmosEventData:
      return idof<cosmos.EventData>()
    case TypeId.CosmosEventVote:
      return idof<cosmos.EventVote>()
    case TypeId.CosmosEvidence:
      return idof<cosmos.Evidence>()
    case TypeId.CosmosEvidenceList:
      return idof<cosmos.EvidenceList>()
    case TypeId.CosmosEvidenceParams:
      return idof<cosmos.EvidenceParams>()
    case TypeId.CosmosFee:
      return idof<cosmos.Fee>()
    case TypeId.CosmosHeader:
      return idof<cosmos.Header>()
    case TypeId.CosmosHeaderOnlyBlock:
      return idof<cosmos.HeaderOnlyBlock>()
    case TypeId.CosmosLightBlock:
      return idof<cosmos.LightBlock>()
    case TypeId.CosmosLightClientAttackEvidence:
      return idof<cosmos.LightClientAttackEvidence>()
    case TypeId.CosmosModeInfo:
      return idof<cosmos.ModeInfo>()
    case TypeId.CosmosModeInfoMulti:
      return idof<cosmos.ModeInfoMulti>()
    case TypeId.CosmosModeInfoSingle:
      return idof<cosmos.ModeInfoSingle>()
    case TypeId.CosmosPartSetHeader:
      return idof<cosmos.PartSetHeader>()
    case TypeId.CosmosPublicKey:
      return idof<cosmos.PublicKey>()
    case TypeId.CosmosResponseBeginBlock:
      return idof<cosmos.ResponseBeginBlock>()
    case TypeId.CosmosResponseDeliverTx:
      return idof<cosmos.ResponseDeliverTx>()
    case TypeId.CosmosResponseEndBlock:
      return idof<cosmos.ResponseEndBlock>()
    case TypeId.CosmosSignModeEnum:
      return idof<Array<cosmos.SignMode>>()
    case TypeId.CosmosSignedHeader:
      return idof<cosmos.SignedHeader>()
    case TypeId.CosmosSignedMsgTypeEnum:
      return idof<Array<cosmos.SignedMsgType>>()
    case TypeId.CosmosSignerInfo:
      return idof<cosmos.SignerInfo>()
    case TypeId.CosmosTimestamp:
      return idof<cosmos.Timestamp>()
    case TypeId.CosmosTip:
      return idof<cosmos.Tip>()
    case TypeId.CosmosTransactionData:
      return idof<cosmos.TransactionData>()
    case TypeId.CosmosTx:
      return idof<cosmos.Tx>()
    case TypeId.CosmosTxBody:
      return idof<cosmos.TxBody>()
    case TypeId.CosmosTxResult:
      return idof<cosmos.TxResult>()
    case TypeId.CosmosValidator:
      return idof<cosmos.Validator>()
    case TypeId.CosmosValidatorParams:
      return idof<cosmos.ValidatorParams>()
    case TypeId.CosmosValidatorSet:
      return idof<cosmos.ValidatorSet>()
    case TypeId.CosmosValidatorSetUpdates:
      return idof<cosmos.ValidatorSetUpdates>()
    case TypeId.CosmosValidatorUpdate:
      return idof<cosmos.ValidatorUpdate>()
    case TypeId.CosmosVersionParams:
      return idof<cosmos.VersionParams>()
    /**
     * Arweave type ids
     */
    case TypeId.ArweaveBlock:
      return idof<arweave.Block>()
    case TypeId.ArweaveProofOfAccess:
      return idof<arweave.ProofOfAccess>()
    case TypeId.ArweaveTag:
      return idof<arweave.Tag>()
    case TypeId.ArweaveTagArray:
      return idof<Array<arweave.Tag>>()
    case TypeId.ArweaveTransaction:
      return idof<arweave.Transaction>()
    case TypeId.ArweaveTransactionArray:
      return idof<Array<arweave.Transaction>>()
    case TypeId.ArweaveTransactionWithBlockPtr:
      return idof<arweave.TransactionWithBlockPtr>()
    default:
      return 0
  }
}

export function allocate(size: usize): usize {
  // @ts-ignore We do not want to expose __alloc, hence why we just ignore the error
  return __alloc(size)
}
