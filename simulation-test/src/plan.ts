import { Rng } from "./random.js";

/**
 * Everything about a simulation is decided by its plan, and the plan is
 * decided by the seed alone.
 */
export type Plan = {
  seed: string;
  /** Virtual time (unix ms) when the first app starts. */
  startTime: number;
  /**
   * Virtual ms that the simulation runs after `startTime`. Chains mine blocks
   * until then, and the last run stops then.
   */
  duration: number;
  chains: ChainPlan[];
  /** Variants of the app. Every variant uses the same database. */
  apps: AppPlan[];
  /** Runs of the apps, one after the other. */
  runs: RunPlan[];
  database: DatabasePlan;
  scheduler: {
    /** Probability that the clock jumps before a task. */
    jumpRate: number;
    /** Durations (ms) of the jumps. */
    jumps: number[];
  };
};

export type ChainPlan = {
  id: number;
  name: string;
  /** Seconds between blocks. */
  blockTime: number;
  /** Timestamp (s) of block 0. */
  genesisTimestamp: number;
  /**
   * Blocks that exist when the first app starts. The chain mines one block
   * every `blockTime` seconds after that, until the end of the simulation.
   */
  historicalBlocks: number;
  /** Relative number of transactions per block. */
  activity: number;
  /** Probability that mining a block reorgs the latest blocks first. */
  reorgRate: number;
  /** Maximum depth of a reorg, in blocks. */
  maxReorgDepth: number;
  /** `reorgWindow` in the config, in seconds. */
  reorgWindow: number;
  /** `pollingInterval` in the config. */
  pollingInterval: number;
  /** Subscribe to new heads with `eth_subscribe`, instead of polling. */
  subscribe: boolean;
  rpcs: RpcPlan[];
};

/** Limits of `eth_getLogs` requests. A request over a limit fails. */
export type GetLogsLimitPlan = {
  /** Maximum number of blocks in a request. */
  maxBlocks: number | undefined;
  /** Maximum number of logs in a response. */
  maxLogs: number | undefined;
  /** The error suggests a block range under the limits. */
  suggestsRange: boolean;
};

export type RpcPlan = {
  /** Latency (ms) of a request is drawn from [min, max]. */
  latency: { min: number; max: number };
  /** Extra latency (ms) per 100 results, such as logs or transactions. */
  latencyPerResult: number;
  /** Probability that a request fails with a transient error. */
  errorRate: number;
  /**
   * Periods (ms since the start of the simulation) in which a request fails
   * with HTTP 503 after half its latency, with probability `errorRate`.
   */
  outages?: { from: number; to: number; errorRate: number }[];
  /** Requests in each second over this limit fail with HTTP 429. */
  rateLimit: number | undefined;
  getLogs: GetLogsLimitPlan;
  /** How long (ms) the provider takes to see a new block. */
  lag: number;
  /** Supports `eth_getBlockReceipts`. */
  blockReceipts: boolean;
  /** Probability that a subscription drops a new head notification. */
  dropRate: number;
  /** Probability per notification that the subscription disconnects. */
  disconnectRate: number;
};

export type DatabasePlan = {
  /** `poolConfig.max` in the config. */
  poolMax: number;
  /** Probability that a transaction fails and rolls back instead of committing. */
  transactionErrorRate: number;
  /** Latency (ms) of a statement is drawn from [min, max]. */
  latency: { min: number; max: number };
};

export type AddressPlan =
  | { kind: "single"; token: number }
  | { kind: "list"; tokens: number[] }
  | {
      kind: "factory";
      event: "PoolCreated" | "Deployed";
      filterAddress: boolean;
      /** `startBlock` of the factory, for child addresses. */
      startBlock: number | undefined;
    };

/** A block range, relative to the chain: block numbers. */
export type RangePlan = {
  startBlock: number | undefined;
  endBlock: number | undefined;
};

export type ContractPlan = {
  name: string;
  kind: "token" | "pool" | "factory";
  /** Event names with indexing functions. */
  events: string[];
  chains: {
    [chainName: string]: RangePlan & {
      address: AddressPlan;
      /** `filter` of the contract, on `Transfer` and `Approval`. */
      filter: "none" | "from-zero" | "to-list" | "multiple";
      includeTransactionReceipts: boolean;
      includeCallTraces: boolean;
    };
  };
  /** Function names with call trace indexing functions. */
  functions: string[];
  setup: boolean;
};

export type AccountPlan = {
  name: string;
  /** Index into `EOAS`, or `dead`. */
  address: number | "dead";
  chains: {
    [chainName: string]: RangePlan & { includeTransactionReceipts: boolean };
  };
  events: (
    | "transaction:from"
    | "transaction:to"
    | "transfer:from"
    | "transfer:to"
  )[];
};

export type BlockSourcePlan = {
  name: string;
  chains: { [chainName: string]: RangePlan & { interval: number } };
};

export type AppPlan = {
  id: string;
  ordering: "omnichain" | "multichain";
  /** Chains of the app, a subset of the plan's chains. */
  chains: string[];
  cacheRpcRequests: { [chainName: string]: boolean };
  ethGetLogsBlockRange: { [chainName: string]: number | undefined };
  contracts: ContractPlan[];
  accounts: AccountPlan[];
  blocks: BlockSourcePlan[];
  /** Behavior of the indexing functions. */
  indexing: {
    /** Probability per event of each `context.db` operation. */
    dbRate: number;
    /** Probability per event of a `context.client` request. */
    clientRate: number;
    /** Probability per event of reading each event field group. */
    fieldRate: number;
    /** Use raw SQL in the indexing functions. */
    sql: boolean;
    /** Probability per event that the indexing function writes nothing. */
    skipRate: number;
  };
};

/**
 * A run starts an app when the previous run stops, and stops it at `stopAt`.
 * The app exiting before then fails the simulation.
 */
export type RunPlan = {
  /** Index into `apps`. */
  app: number;
  /** Virtual ms after `startTime`. The last run stops at `duration`. */
  stopAt: number;
  /**
   * How the app stops: with a graceful shutdown, or like a killed process,
   * whose database statements fail and whose open transactions roll back.
   */
  stop: "graceful" | "kill";
};

const CHAIN_IDS = [1, 10, 8453, 42161] as const;
const CHAIN_NAMES = ["mainnet", "optimism", "base", "arbitrum"] as const;

export const makePlan = (seed: string): Plan => {
  const rng = new Rng(seed, "plan");

  // Note: Chains start at similar timestamps. The first app starts when every
  // chain has its historical blocks.
  const startTime = Date.UTC(2025, 0, 1) + rng.int(0, 1_000) * 3_600_000;
  const duration = rng.int(60, 600) * 1_000;
  const chainCount = rng.weighted([
    [1, 3],
    [2, 3],
    [3, 2],
    [4, 2],
  ] as const);

  const chains: ChainPlan[] = Array.from({ length: chainCount }, (_, i) => {
    const r = rng.fork(`chain:${i}`);
    const blockTime = r.pick([1, 2, 2, 12, 12, 5]);
    const historicalBlocks = r.int(20, 600);
    const reorgWindow = r.pick([0, 30, 60, 180]);
    const maxReorgDepth =
      reorgWindow === 0
        ? 0
        : Math.max(0, Math.min(6, Math.floor(reorgWindow / blockTime) - 1));
    return {
      id: CHAIN_IDS[i]!,
      name: CHAIN_NAMES[i]!,
      blockTime,
      genesisTimestamp:
        Math.floor(startTime / 1000) -
        historicalBlocks * blockTime -
        r.int(0, blockTime - 1),
      historicalBlocks,
      activity: r.float(0.2, 2),
      reorgRate: maxReorgDepth === 0 ? 0 : r.pick([0, 0.02, 0.05, 0.15]),
      maxReorgDepth,
      reorgWindow,
      pollingInterval: r.pick([250, 1_000, 2_000]),
      subscribe: r.bool(0.4),
      rpcs: Array.from(
        {
          length: r.weighted([
            [1, 5],
            [2, 3],
            [3, 1],
          ] as const),
        },
        (_, j) => makeRpcPlan(r.fork(`rpc:${j}`)),
      ),
    };
  });

  const apps = Array.from(
    {
      length: rng.weighted([
        [1, 3],
        [2, 2],
        [3, 1],
      ] as const),
    },
    (_, i) => makeAppPlan(rng.fork(`app:${i}`), `app${i}`, chains, duration),
  );

  const runCount = rng.weighted([
    [1, 3],
    [2, 3],
    [3, 2],
    [4, 1],
  ] as const);
  const stops = Array.from({ length: runCount - 1 }, () =>
    rng.int(1, duration / 1_000 - 1),
  ).sort((a, b) => a - b);
  const runs: RunPlan[] = Array.from({ length: runCount }, (_, i) => ({
    // Note: Restarts often use the same app, which resumes from the cache
    // and crash recovery checkpoint.
    app: i === 0 ? 0 : rng.bool(0.6) ? 0 : rng.int(0, apps.length - 1),
    stopAt: i === runCount - 1 ? duration : stops[i]! * 1_000,
    stop: i < runCount - 1 && rng.bool(0.3) ? "kill" : "graceful",
  }));

  const dbRng = rng.fork("database");
  const database: DatabasePlan = {
    poolMax: dbRng.pick([8, 14, 30]),
    transactionErrorRate: dbRng.pick([0, 0.02, 0.1]),
    latency: { min: 0, max: dbRng.pick([1, 5, 20]) },
  };

  return {
    seed,
    startTime,
    duration,
    chains,
    apps,
    runs,
    database,
    scheduler: {
      jumpRate: rng.pick([0, 0.001, 0.01]),
      jumps: [1, 10, 100, 1_000],
    },
  };
};

const makeRpcPlan = (r: Rng): RpcPlan => {
  const min = r.int(5, 150);
  return {
    latency: { min, max: min + r.int(0, 400) },
    latencyPerResult: r.pick([0, 1, 10]),
    errorRate: r.pick([0, 0, 0.01, 0.05, 0.15]),
    rateLimit: r.pick([undefined, undefined, 10, 25, 100]),
    getLogs: {
      maxBlocks: r.pick([undefined, undefined, 5, 50, 1_000]),
      maxLogs: r.pick([undefined, undefined, 20, 200]),
      suggestsRange: r.bool(),
    },
    lag: r.pick([0, 0, 200, 1_500, 5_000]),
    blockReceipts: r.bool(0.7),
    dropRate: r.pick([0, 0.05, 0.3]),
    disconnectRate: r.pick([0, 0.01, 0.05]),
  };
};

/** The number of the last block that `chain` mines in the simulation. */
export const getLastBlock = (chain: ChainPlan, duration: number) =>
  chain.historicalBlocks + Math.floor(duration / 1_000 / chain.blockTime) - 1;

const makeRange = (r: Rng, chain: ChainPlan, duration: number): RangePlan => {
  const total = getLastBlock(chain, duration) + 1;
  const startBlock = r.weighted([
    [undefined, 1],
    [r.int(0, chain.historicalBlocks - 1), 3],
    // Note: Starts in the live range.
    [r.int(chain.historicalBlocks, total - 1), 1],
  ] as const);
  const endBlock = r.weighted([
    [undefined, 4],
    [
      Math.min(total - 1, (startBlock ?? 0) + r.int(0, chain.historicalBlocks)),
      1,
    ],
  ] as const);
  return { startBlock, endBlock };
};

const makeAppPlan = (
  r: Rng,
  id: string,
  allChains: ChainPlan[],
  duration: number,
): AppPlan => {
  const chains = r.subset(allChains, 1);
  const chainNames = chains.map((c) => c.name);
  const forChains = <T>(f: (chain: ChainPlan, r: Rng) => T) =>
    Object.fromEntries(
      r
        .subset(chains, 1)
        .map((chain) => [chain.name, f(chain, r.fork(chain.name))]),
    );

  const contracts: ContractPlan[] = [];
  const contractKinds = r.subset(["token", "pool", "factory"] as const, 1);
  for (const kind of contractKinds) {
    const events =
      kind === "token"
        ? ["Transfer", "Approval", "Memo"]
        : kind === "pool"
          ? ["Swap", "Sync"]
          : ["PoolCreated", "Deployed"];
    const functions =
      kind === "token"
        ? ["transfer", "approve", "memo"]
        : kind === "pool"
          ? ["swap"]
          : ["createPool"];
    const includeCallTraces = r.bool(0.4);
    contracts.push({
      name: kind === "token" ? "Token" : kind === "pool" ? "Pool" : "Factory",
      kind,
      events: r.subset(events, 1),
      chains: forChains((chain, r) => {
        const config: ContractPlan["chains"][string] = {
          ...makeRange(r, chain, duration),
          address:
            kind === "pool"
              ? {
                  kind: "factory",
                  event: r.pick(["PoolCreated", "Deployed"] as const),
                  filterAddress: r.bool(0.8),
                  startBlock: r.bool(0.3)
                    ? r.int(0, chain.historicalBlocks)
                    : undefined,
                }
              : kind === "factory"
                ? { kind: "single", token: 0 }
                : r.bool()
                  ? { kind: "single", token: r.int(0, 2) }
                  : { kind: "list", tokens: r.subset([0, 1, 2], 1) },
          filter:
            kind === "token"
              ? r.pick([
                  "none",
                  "none",
                  "from-zero",
                  "to-list",
                  "multiple",
                ] as const)
              : "none",
          includeTransactionReceipts: r.bool(0.3),
          includeCallTraces,
        };
        // Note: A contract can't start before the factory of its addresses.
        if (
          config.address.kind === "factory" &&
          config.address.startBlock !== undefined &&
          (config.startBlock ?? 0) < config.address.startBlock
        ) {
          config.startBlock = config.address.startBlock;
          if (
            config.endBlock !== undefined &&
            config.endBlock < config.startBlock
          ) {
            config.endBlock = config.startBlock;
          }
        }
        return config;
      }),
      functions: includeCallTraces ? r.subset(functions, 1) : [],
      setup: r.bool(0.3),
    });
  }

  const accounts: AccountPlan[] = r.bool(0.5)
    ? [
        {
          name: "Account",
          address: r.bool(0.8) ? r.int(0, 7) : "dead",
          chains: forChains((chain, r) => ({
            ...makeRange(r, chain, duration),
            includeTransactionReceipts: r.bool(0.3),
          })),
          events: r.subset(
            [
              "transaction:from",
              "transaction:to",
              "transfer:from",
              "transfer:to",
            ] as const,
            1,
          ),
        },
      ]
    : [];

  const blocks: BlockSourcePlan[] = r.bool(0.5)
    ? [
        {
          name: "Blocks",
          chains: forChains((chain, r) => ({
            ...makeRange(r, chain, duration),
            interval: r.pick([1, 1, 5, 25]),
          })),
        },
      ]
    : [];

  return {
    id,
    ordering: r.pick(["omnichain", "multichain"] as const),
    chains: chainNames,
    cacheRpcRequests: Object.fromEntries(
      chainNames.map((name) => [name, r.bool(0.85)]),
    ),
    // Note: With `ethGetLogsBlockRange`, Ponder doesn't split a range that a
    // provider rejects, so it is within the limits of every provider.
    ethGetLogsBlockRange: Object.fromEntries(
      chains.map((chain) => {
        const hasLogLimit = chain.rpcs.some(
          (rpc) => rpc.getLogs.maxLogs !== undefined,
        );
        const maxBlocks = Math.min(
          ...chain.rpcs.map((rpc) => rpc.getLogs.maxBlocks ?? 1_000),
        );
        return [
          chain.name,
          hasLogLimit === false && r.bool(0.15)
            ? r.int(1, maxBlocks)
            : undefined,
        ];
      }),
    ),
    contracts,
    accounts,
    blocks,
    indexing: {
      dbRate: r.pick([0.2, 0.5, 0.9]),
      clientRate: r.pick([0, 0.05, 0.3]),
      fieldRate: r.pick([0.05, 0.3]),
      sql: r.bool(0.3),
      skipRate: r.pick([0, 0, 0.3]),
    },
  };
};
