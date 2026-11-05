import { Clock, Effect, Fiber, Queue, type Scope, Stream } from "effect";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  multicall3Abi,
  numberToHex,
} from "viem";
import {
  RpcHttpError,
  RpcNetworkError,
  RpcResponseError,
  type RpcSubscribeTransport,
  RpcTimeoutError,
  type RpcTransport,
  type RpcTransportError,
} from "@/rpc/transport.js";
import { WebSocketClosedError } from "@/rpc/webSocket.js";
import type { ChainView, Frame, SimBlock, SimChain, SimLog } from "./chain.js";
import type { RpcPlan } from "./plan.js";
import type { Rng } from "./random.js";
import { multicall3Address, poolAbi, state, tokenAbi } from "./shared.js";

/** Counts of what a provider did, for the summary of a run. */
export type RpcStats = {
  requests: number;
  rateLimited: number;
  errors: number;
  rangeErrors: number;
};

type RequestBody = { method: string; params?: unknown };

// Formatting

const formatLog = (block: SimBlock, transactionIndex: number, log: SimLog) => {
  const transaction = block.transactions[transactionIndex]!;
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: numberToHex(block.number),
    blockHash: block.hash,
    transactionHash: transaction.hash,
    transactionIndex: numberToHex(transaction.index),
    logIndex: numberToHex(log.logIndex),
    removed: false,
  };
};

const formatTransaction = (block: SimBlock, index: number) => {
  const t = block.transactions[index]!;
  return {
    hash: t.hash,
    blockHash: block.hash,
    blockNumber: numberToHex(block.number),
    transactionIndex: numberToHex(t.index),
    from: t.from,
    to: t.to,
    input: t.input,
    value: numberToHex(t.value),
    nonce: numberToHex(t.nonce),
    gas: numberToHex(t.gas),
    gasPrice: numberToHex(1_000_000_000n),
    maxFeePerGas: numberToHex(2_000_000_000n),
    maxPriorityFeePerGas: numberToHex(1_000_000n),
    r: numberToHex(BigInt(t.hash) >> 8n, { size: 32 }),
    s: numberToHex(BigInt(t.hash) >> 16n, { size: 32 }),
    v: "0x1",
    yParity: "0x1",
    type: "0x2",
    chainId: undefined,
    accessList: [],
  };
};

const formatBlock = (block: SimBlock, full: boolean) => ({
  number: numberToHex(block.number),
  hash: block.hash,
  parentHash: block.parentHash,
  timestamp: numberToHex(block.timestamp),
  logsBloom: block.logsBloom,
  miner: block.miner,
  gasUsed: numberToHex(
    block.transactions.reduce((sum, t) => sum + t.gasUsed, 0n),
  ),
  gasLimit: numberToHex(30_000_000n),
  baseFeePerGas: numberToHex(1_000_000_000n),
  nonce: "0x0000000000000000",
  mixHash: block.hash,
  stateRoot: block.hash,
  receiptsRoot: block.hash,
  transactionsRoot: block.hash,
  sha3Uncles:
    "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  size: numberToHex(500 + block.transactions.length * 200),
  difficulty: "0x0",
  totalDifficulty: "0x0",
  extraData: "0x",
  uncles: [],
  transactions: full
    ? block.transactions.map((_, i) => formatTransaction(block, i))
    : block.transactions.map((t) => t.hash),
});

const formatHeader = (block: SimBlock) => {
  const { transactions: _, uncles: __, ...header } = formatBlock(block, false);
  return header;
};

const formatReceipt = (block: SimBlock, index: number) => {
  const t = block.transactions[index]!;
  let cumulativeGasUsed = 0n;
  for (let i = 0; i <= index; i++) {
    cumulativeGasUsed += block.transactions[i]!.gasUsed;
  }
  return {
    blockHash: block.hash,
    blockNumber: numberToHex(block.number),
    transactionHash: t.hash,
    transactionIndex: numberToHex(t.index),
    from: t.from,
    to: t.to,
    contractAddress: null,
    cumulativeGasUsed: numberToHex(cumulativeGasUsed),
    gasUsed: numberToHex(t.gasUsed),
    effectiveGasPrice: numberToHex(1_000_000_000n),
    logs: t.logs.map((log) => formatLog(block, index, log)),
    logsBloom: t.logsBloom,
    status: t.status,
    type: "0x2",
    root: undefined,
  };
};

const formatFrame = (frame: Frame): unknown => ({
  type: frame.type,
  from: frame.from,
  to: frame.to,
  input: frame.input,
  output: frame.output,
  value: frame.value === undefined ? undefined : numberToHex(frame.value),
  gas: numberToHex(frame.gas),
  gasUsed: numberToHex(frame.gasUsed),
  error: frame.error,
  revertReason: frame.error === undefined ? undefined : "reverted",
  calls: frame.calls?.map(formatFrame),
});

const formatTraces = (block: SimBlock) =>
  block.transactions.map((t) => ({
    txHash: t.hash,
    result: formatFrame(t.trace),
  }));

// Filters

const matchesValue = (filter: unknown, value: string | undefined) => {
  if (filter === null || filter === undefined) return true;
  if (value === undefined) return false;
  if (Array.isArray(filter)) {
    return filter.some((f) => f.toLowerCase() === value.toLowerCase());
  }
  return (filter as string).toLowerCase() === value.toLowerCase();
};

type LogFilter = {
  fromBlock?: Hex;
  toBlock?: Hex;
  blockHash?: Hex;
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
};

const filterLogs = (block: SimBlock, filter: LogFilter) => {
  const logs: ReturnType<typeof formatLog>[] = [];
  for (const transaction of block.transactions) {
    for (const log of transaction.logs) {
      if (matchesValue(filter.address, log.address) === false) continue;
      if (
        (filter.topics ?? []).every((topic, i) =>
          matchesValue(topic, log.topics[i]),
        ) === false
      ) {
        continue;
      }
      logs.push(formatLog(block, transaction.index, log));
    }
  }
  return logs;
};

/** Allows at most `limit` requests in each window of one second. */
const makeRateLimiter = (limit: number | undefined) => {
  const times: number[] = [];
  return (now: number) => {
    if (limit === undefined) return true;
    while (times.length > 0 && times[0]! <= now - 1_000) times.shift();
    if (times.length >= limit) return false;
    times.push(now);
    return true;
  };
};

class MethodError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A simulated JSON-RPC provider for `chain`. Responses are read from the
 * chain as the provider sees it, `plan.lag` ms behind the clock.
 */
export const makeSimRpc = ({
  chain,
  plan,
  index,
  rng,
  startTime,
}: {
  chain: SimChain;
  plan: RpcPlan;
  index: number;
  rng: Rng;
  /** The start of the simulation, for `plan.outages`. */
  startTime: number;
}) => {
  const hostname = `sim-${chain.plan.name}-${index}`;
  const isAllowed = makeRateLimiter(plan.rateLimit);
  const stats: RpcStats = {
    requests: 0,
    rateLimited: 0,
    errors: 0,
    rangeErrors: 0,
  };

  const latency = () => rng.int(plan.latency.min, plan.latency.max);
  /** Sleeps `ms`, without yielding when it is 0, as for a local provider. */
  const sleep = (ms: number) => (ms > 0 ? Effect.sleep(ms) : Effect.void);

  const handle = (view: ChainView, body: RequestBody): unknown => {
    const params = (body.params ?? []) as any[];
    switch (body.method) {
      case "eth_chainId":
        return numberToHex(chain.plan.id);
      case "eth_getBlockByNumber": {
        const block = view.resolve(params[0]);
        return block ? formatBlock(block, params[1] === true) : null;
      }
      case "eth_getBlockByHash": {
        const block = view.blockByHash(params[0]);
        return block ? formatBlock(block, params[1] === true) : null;
      }
      case "eth_getTransactionReceipt": {
        const result = view.transaction(params[0]);
        return result
          ? formatReceipt(result.block, result.transaction.index)
          : null;
      }
      case "eth_getBlockReceipts": {
        if (plan.blockReceipts === false) {
          throw new MethodError(
            -32601,
            "the method eth_getBlockReceipts does not exist/is not available",
          );
        }
        const block = view.resolve(params[0]);
        return block
          ? block.transactions.map((_, i) => formatReceipt(block, i))
          : null;
      }
      case "debug_traceBlockByNumber":
      case "debug_traceBlockByHash": {
        const block = view.resolve(params[0]);
        if (block === undefined) {
          throw new MethodError(-32000, `block ${params[0]} not found`);
        }
        return formatTraces(block);
      }
      case "eth_getLogs":
        return getLogs(view, params[0] as LogFilter);
      case "eth_call": {
        const block = resolveState(view, params[1]);
        return call(block, params[0].to, params[0].data ?? params[0].input);
      }
      case "eth_getBalance": {
        const block = resolveState(view, params[1]);
        return numberToHex(state.balance(block.hash, params[0]));
      }
      case "eth_getCode": {
        const block = resolveState(view, params[1]);
        return state.code(isContract(block, params[0]), params[0]);
      }
      default:
        throw new MethodError(
          -32601,
          `the method ${body.method} does not exist/is not available`,
        );
    }
  };

  /** The block of a state method, such as `eth_call`. */
  const resolveState = (view: ChainView, tag: unknown) => {
    const block = view.resolve(tag);
    if (block === undefined) throw new MethodError(-32000, "header not found");
    return block;
  };

  const isContract = (block: SimBlock, address: Address) => {
    const a = address.toLowerCase() as Address;
    return (
      a === chain.factory || chain.tokens.includes(a) || block.pools.includes(a)
    );
  };

  const call = (block: SimBlock, to: Address, data: Hex): Hex => {
    const address = to.toLowerCase() as Address;
    if (address === multicall3Address) {
      const { args } = decodeFunctionData({ abi: multicall3Abi, data });
      const calls = args[0] as readonly {
        target: Address;
        allowFailure: boolean;
        callData: Hex;
      }[];
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: calls.map((c) => {
          try {
            return {
              success: true,
              returnData: call(block, c.target, c.callData),
            };
          } catch {
            return { success: false, returnData: "0x" as Hex };
          }
        }),
      });
    }
    if (chain.tokens.includes(address)) {
      const { functionName, args } = decodeFunctionData({
        abi: tokenAbi,
        data,
      });
      switch (functionName) {
        case "balanceOf":
          return encodeFunctionResult({
            abi: tokenAbi,
            functionName,
            result: state.balanceOf(block.hash, address, args[0]),
          });
        case "totalSupply":
          return encodeFunctionResult({
            abi: tokenAbi,
            functionName,
            result: state.totalSupply(block.hash, address),
          });
        case "name":
          return encodeFunctionResult({
            abi: tokenAbi,
            functionName,
            result: state.name(address),
          });
        default:
          throw new MethodError(3, "execution reverted");
      }
    }
    if (block.pools.includes(address)) {
      const { functionName } = decodeFunctionData({ abi: poolAbi, data });
      if (functionName === "getReserves") {
        return encodeFunctionResult({
          abi: poolAbi,
          functionName,
          result: state.getReserves(
            block.hash,
            address,
            BigInt(block.timestamp),
          ),
        });
      }
      throw new MethodError(3, "execution reverted");
    }
    // Note: A call to an account without code succeeds without data.
    return "0x";
  };

  const getLogs = (view: ChainView, filter: LogFilter) => {
    if (filter.blockHash !== undefined) {
      const block = view.blockByHash(filter.blockHash);
      if (block === undefined) {
        throw new MethodError(-32000, `unknown block ${filter.blockHash}`);
      }
      return filterLogs(block, filter);
    }

    const head = view.head.number;
    const from = view.resolve(filter.fromBlock ?? "latest")?.number;
    const toBlock = filter.toBlock ?? "latest";
    const to =
      typeof toBlock === "string" && toBlock.startsWith("0x")
        ? Number(toBlock)
        : view.resolve(toBlock)?.number;
    if (from === undefined || to === undefined) {
      throw new MethodError(
        -32000,
        "block range extends beyond current head block",
      );
    }
    if (to > head) {
      throw new MethodError(
        -32000,
        "block range extends beyond current head block",
      );
    }
    if (from > to) {
      throw new MethodError(-32602, "invalid block range params");
    }

    const { maxBlocks, maxLogs, suggestsRange } = plan.getLogs;
    /** The error of a request over a limit, which can suggest a smaller range. */
    const tooLarge = (suggestedTo: number) => {
      stats.rangeErrors++;
      return new MethodError(
        -32005,
        suggestsRange
          ? `block range too large, this block range should work: [${numberToHex(from)}, ${numberToHex(suggestedTo)}]`
          : "block range too large",
      );
    };

    if (maxBlocks !== undefined && to - from + 1 > maxBlocks) {
      throw tooLarge(from + maxBlocks - 1);
    }

    const logs: ReturnType<typeof formatLog>[] = [];
    for (let n = from; n <= to; n++) {
      const blockLogs = filterLogs(view.block(n)!, filter);
      if (
        maxLogs !== undefined &&
        logs.length + blockLogs.length > maxLogs &&
        n > from
      ) {
        throw tooLarge(n - 1);
      }
      logs.push(...blockLogs);
    }
    return logs;
  };

  /** The number of results in a response, for its latency. */
  const size = (response: unknown) =>
    Array.isArray(response)
      ? response.length
      : response !== null &&
          typeof response === "object" &&
          "transactions" in response
        ? (response.transactions as unknown[]).length
        : 1;

  const transientError = (
    method: string,
  ): Effect.Effect<never, RpcTransportError> => {
    const kind = rng.pick([
      "network",
      "http500",
      "http503",
      "internal",
      "timeout",
      "header",
    ] as const);
    switch (kind) {
      case "network":
        return Effect.fail(
          new RpcNetworkError({
            method,
            hostname,
            cause: new Error("socket hang up"),
          }),
        );
      case "http500":
        return Effect.fail(
          new RpcHttpError({
            method,
            hostname,
            status: 500,
            body: "Internal Server Error",
          }),
        );
      case "http503":
        return Effect.fail(
          new RpcHttpError({ method, hostname, status: 503, body: "" }),
        );
      case "internal":
        return Effect.fail(
          new RpcResponseError({
            method,
            hostname,
            code: -32603,
            details: "internal error",
          }),
        );
      case "timeout":
        return Effect.sleep(10_000).pipe(
          Effect.andThen(
            Effect.fail(
              new RpcTimeoutError({ method, hostname, timeout: 10_000 }),
            ),
          ),
        );
      case "header":
        return Effect.fail(
          new RpcResponseError({
            method,
            hostname,
            code: -32000,
            details: "header not found",
          }),
        );
    }
  };

  const transport: RpcTransport = {
    hostname,
    request: (body) =>
      Effect.gen(function* () {
        stats.requests++;
        const start = yield* Clock.currentTimeMillis;

        if (isAllowed(start) === false) {
          stats.rateLimited++;
          yield* sleep(rng.int(1, plan.latency.min + 1));
          return yield* Effect.fail(
            new RpcHttpError({
              method: body.method,
              hostname,
              status: 429,
              body: '{"jsonrpc":"2.0","error":{"code":429,"message":"Too Many Requests"}}',
            }),
          );
        }

        const total = latency();
        yield* sleep(Math.floor(total / 2));

        const outage = plan.outages?.find(
          ({ from, to }) => start >= startTime + from && start < startTime + to,
        );
        if (outage !== undefined && rng.bool(outage.errorRate)) {
          stats.errors++;
          return yield* Effect.fail(
            new RpcHttpError({
              method: body.method,
              hostname,
              status: 503,
              body: "Service Unavailable",
            }),
          );
        }

        if (rng.bool(plan.errorRate)) {
          stats.errors++;
          return yield* transientError(body.method);
        }

        const now = yield* Clock.currentTimeMillis;
        let response: unknown;
        try {
          response = handle(chain.view(now - plan.lag), body as RequestBody);
        } catch (error) {
          if (error instanceof MethodError) {
            yield* sleep(Math.ceil(total / 2));
            return yield* Effect.fail(
              new RpcResponseError({
                method: body.method,
                hostname,
                code: error.code,
                details: error.message,
              }),
            );
          }
          return yield* Effect.die(error);
        }

        yield* sleep(
          Math.ceil(total / 2) +
            Math.floor((size(response) * plan.latencyPerResult) / 100),
        );
        // Note: A response is serialized, so later changes to the chain don't
        // change it.
        return JSON.parse(JSON.stringify(response));
      }),
  };

  /** A WebSocket connection that only supports `eth_subscribe` to `newHeads`. */
  const connect: Effect.Effect<
    RpcSubscribeTransport,
    RpcTransportError,
    Scope.Scope
  > = Effect.gen(function* () {
    yield* sleep(latency());
    if (rng.bool(plan.errorRate)) {
      return yield* Effect.fail(
        new RpcNetworkError({
          method: "eth_subscribe",
          hostname,
          cause: new Error("connection refused"),
        }),
      );
    }

    let subscriptionCount = 0;
    return {
      hostname,
      subscribe: (params) =>
        Effect.gen(function* () {
          if (params[0] !== "newHeads") {
            return yield* Effect.fail(
              new RpcResponseError({
                method: "eth_subscribe",
                hostname,
                code: -32602,
                details: "unsupported subscription",
              }),
            );
          }
          yield* sleep(latency());

          const incoming = yield* Queue.unbounded<SimBlock>();
          const outgoing = yield* Queue.unbounded<unknown, RpcTransportError>();
          const listener = (block: SimBlock) => {
            Queue.offerUnsafe(incoming, block);
          };
          yield* Effect.acquireRelease(
            Effect.sync(() => chain.listeners.add(listener)),
            () => Effect.sync(() => chain.listeners.delete(listener)),
          );

          const deliver = Effect.gen(function* () {
            while (true) {
              const block = yield* Queue.take(incoming);
              const now = yield* Clock.currentTimeMillis;
              const at = block.minedAt + plan.lag + latency();
              if (at > now) yield* sleep(at - now);
              if (rng.bool(plan.disconnectRate)) {
                yield* Queue.fail(
                  outgoing,
                  new RpcNetworkError({
                    method: "eth_subscribe",
                    hostname,
                    // Note: Some disconnects close the connection cleanly.
                    cause: rng.bool()
                      ? new WebSocketClosedError()
                      : new Error("socket closed abnormally"),
                  }),
                );
                return;
              }
              if (rng.bool(plan.dropRate)) continue;
              yield* Queue.offer(outgoing, formatHeader(block));
            }
          });
          const fiber = yield* Effect.forkScoped(deliver);
          yield* Effect.addFinalizer(() => Fiber.interrupt(fiber));

          return {
            id: numberToHex(++subscriptionCount),
            notifications: Stream.fromQueue(outgoing),
          };
        }),
    };
  });

  return { transport, connect, stats, hostname };
};
