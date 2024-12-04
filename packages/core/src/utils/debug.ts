import type { Address, Hash, Hex, LogTopic } from "viem";

/** @see https://github.com/alloy-rs/alloy/blob/main/crates/rpc-types-trace/src/geth/call.rs */
/** @see https://github.com/alloy-rs/alloy/blob/main/crates/rpc-types-trace/src/common.rs */
/** @see https://github.com/paradigmxyz/reth/blob/main/crates/rpc/rpc/src/debug.rs */

/** Result type for geth style transaction trace. */
export type Trace = {
  /** Transaction hash. */
  txHash: Hex;
  /** Trace results produced by the tracer.  */
  result: CallFrame;
};

/**
 * The response object for `debug_traceBlockByNumber` and `debug_traceBlockByHash`
 * with `"tracer": "callTracer"`.
 */
type CallFrame = {
  /** The type of the call. */
  type:
    | "CALL"
    | "CALLCODE"
    | "DELEGATECALL"
    | "STATICCALL"
    | "CREATE"
    | "CREATE2"
    | "SELFDESTRUCT";
  /** The address of that initiated the call. */
  from: Address;
  /** The address of the contract that was called. */
  to?: Address;
  /** How much gas was left before the call. */
  gas: Hex;
  /** How much gas was used by the call. */
  gasUsed: Hex;
  /** Calldata input. */
  input: Hex;
  /** Output of the call, if any. */
  output?: Hex;
  /** Error message, if any. */
  error?: string;
  /** Why this call reverted, if it reverted. */
  revertReason?: string;
  /** Recorded child calls. */
  calls?: CallFrame[];
  /** Logs emitted by this call. */
  logs?: CallLogFrame[];
  /** Value transferred. */
  value?: Hex;
};

/** Represents a recorded log that is emitted during a trace call. */
type CallLogFrame = {
  /** The address of the contract that was called. */
  address: Address;
  /** The topics of the log. */
  topics: LogTopic[];
  /** The data of the log. */
  data: Hex;
  /** The position of the log relative to subcalls within the same trace. */
  position: number;
};

/** The configuration for the call tracer. */
type CallConfig = {
  /** When set to true, this will only trace the primary (top-level) call and not any sub-calls. */
  onlyTopCall?: boolean;
  /** When set to true, this will include the logs emitted by the call. */
  withLog?: boolean;
};

export type DebugRpcSchema = [
  /**
   * @description Returns tracing results by executing all transactions in the block specified by the block hash
   *
   * @example
   * provider.request({ method: 'debug_traceBlockByHash', params: ['0x...', { tracer: "callTracer" }] })
   * // => {
   * //   txHash: '0x5a42...',
   * //   result: [...],
   * // }
   */
  {
    Method: "debug_traceBlockByHash";
    Parameters: [
      hash: Hash,
      tracingOptions: { tracer: "callTracer"; tracerConfig?: CallConfig },
    ];
    ReturnType: Trace[];
  },
  /**
   * @description Returns tracing results by executing all transactions in the block specified by the block hash
   *
   * @example
   * provider.request({ method: 'debug_traceBlockByNumber', params: ['0x1b4', { tracer: "callTracer" }] })
   * // => {
   * //   txHash: '0x5a42...',
   * //   result: [...],
   * // }
   */
  {
    Method: "debug_traceBlockByNumber";
    Parameters: [
      block: Hex,
      tracingOptions: { tracer: "callTracer"; tracerConfig?: CallConfig },
    ];
    ReturnType: Trace[];
  },
];
