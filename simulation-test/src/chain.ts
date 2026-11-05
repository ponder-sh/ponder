import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  keccak256,
  toHex,
  zeroAddress,
} from "viem";
import type { ChainPlan } from "./plan.js";
import { Rng } from "./random.js";
import {
  DEAD,
  EOAS,
  factoryAbi,
  getFactory,
  getPoolAddress,
  getTokens,
  poolAbi,
  tokenAbi,
} from "./shared.js";

export type SimLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: number;
};

export type Frame = {
  type: "CALL" | "CREATE" | "STATICCALL" | "DELEGATECALL";
  from: Address;
  to: Address;
  input: Hex;
  output?: Hex;
  value?: bigint;
  gas: bigint;
  gasUsed: bigint;
  error?: string;
  calls?: Frame[];
};

export type SimTransaction = {
  hash: Hex;
  index: number;
  from: Address;
  to: Address;
  input: Hex;
  value: bigint;
  nonce: number;
  gas: bigint;
  gasUsed: bigint;
  status: "0x1" | "0x0";
  logs: SimLog[];
  logsBloom: Hex;
  trace: Frame;
};

export type SimBlock = {
  number: number;
  hash: Hex;
  parentHash: Hex;
  timestamp: number;
  fork: number;
  miner: Address;
  transactions: SimTransaction[];
  logsBloom: Hex;
  /** Pools that exist after this block. */
  pools: Address[];
  /** Virtual time (ms) that the block was mined. */
  minedAt: number;
  /** Virtual time (ms) that a reorg replaced the block. */
  replacedAt: number | undefined;
};

const BLOOM_BYTES = 256;

const addToBloom = (bloom: Uint8Array, value: Hex) => {
  const hash = hexToBytes(keccak256(value));
  for (let i = 0; i < 6; i += 2) {
    const bit = ((hash[i]! << 8) | hash[i + 1]!) & 2047;
    bloom[BLOOM_BYTES - 1 - Math.floor(bit / 8)]! |= 1 << (bit % 8);
  }
};

const toBloom = (logs: SimLog[]): Hex => {
  const bloom = new Uint8Array(BLOOM_BYTES);
  for (const log of logs) {
    addToBloom(bloom, log.address);
    for (const topic of log.topics) addToBloom(bloom, topic);
  }
  return toHex(bloom);
};

const GAS = 21_000n;

/**
 * A simulated chain. Blocks are generated from the seed when they are mined,
 * and a reorg replaces the latest blocks with blocks of a new fork.
 *
 * Every version of a block is kept, so that a provider can read the chain as
 * it was at an earlier time.
 */
export class SimChain {
  readonly plan: ChainPlan;
  readonly seed: string;
  readonly tokens: Address[];
  readonly factory: Address;

  /** The canonical chain, by number. */
  readonly canonical: SimBlock[] = [];
  /** Every version of each block, by number, oldest first. */
  readonly versions: SimBlock[][] = [];
  readonly blocksByHash = new Map<Hex, SimBlock>();
  readonly transactionsByHash = new Map<
    Hex,
    { block: SimBlock; transaction: SimTransaction }
  >();
  /** Called after each block is mined. */
  readonly listeners = new Set<(block: SimBlock) => void>();

  private forkCount = 0;
  reorgCount = 0;

  constructor(plan: ChainPlan, seed: string) {
    this.plan = plan;
    this.seed = seed;
    this.tokens = getTokens(plan.id);
    this.factory = getFactory(plan.id);

    for (let n = 0; n < plan.historicalBlocks; n++) {
      this.push(this.generate(n, 0, this.time(n)));
    }
  }

  /** The time (unix ms) when block `number` is mined. */
  time(number: number) {
    return Math.round(
      (this.plan.genesisTimestamp + number * this.plan.blockTime) * 1000,
    );
  }

  /**
   * The timestamp (seconds) of block `number`. Blocks mined in the same
   * second have the same timestamp.
   */
  timestamp(number: number) {
    return Math.floor(this.time(number) / 1000);
  }

  get head(): SimBlock {
    return this.canonical[this.canonical.length - 1]!;
  }

  /** Mine the next block at virtual time `now`. */
  mine(now: number): SimBlock {
    const block = this.generate(this.canonical.length, this.forkCount, now);
    this.push(block);
    return block;
  }

  /**
   * Replace the latest `depth` blocks with blocks of a new fork, at virtual
   * time `now`.
   */
  reorg(depth: number, now: number): SimBlock[] {
    const start = this.canonical.length - depth;
    for (let n = start; n < this.canonical.length; n++) {
      this.canonical[n]!.replacedAt = now;
    }
    this.canonical.length = start;
    this.forkCount++;
    this.reorgCount++;
    const blocks: SimBlock[] = [];
    for (let i = 0; i < depth; i++) {
      blocks.push(this.mine(now));
    }
    return blocks;
  }

  private push(block: SimBlock) {
    this.canonical.push(block);
    (this.versions[block.number] ??= []).push(block);
    this.blocksByHash.set(block.hash, block);
    for (const transaction of block.transactions) {
      this.transactionsByHash.set(transaction.hash, { block, transaction });
    }
    for (const listener of this.listeners) listener(block);
  }

  /**
   * The canonical chain at virtual time `at`.
   */
  view(at: number): ChainView {
    return new ChainView(this, at);
  }

  private generate(number: number, fork: number, minedAt: number): SimBlock {
    const rng = new Rng(this.seed, `block:${this.plan.id}:${number}:${fork}`);
    const parent = this.canonical[number - 1];
    const hash = keccak256(
      toHex(`block:${this.seed}:${this.plan.id}:${number}:${fork}`),
    );
    const pools = [...(parent?.pools ?? [])];
    const transactions: SimTransaction[] = [];

    const count = rng.pick(this.plan.activity);

    let logIndex = 0;
    for (let index = 0; index < count; index++) {
      const transaction = this.generateTransaction({
        rng,
        number,
        fork,
        index,
        pools,
        logIndex,
      });
      logIndex += transaction.logs.length;
      transactions.push(transaction);
    }

    return {
      number,
      hash,
      parentHash:
        parent?.hash ??
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: this.timestamp(number),
      fork,
      miner: EOAS[number % EOAS.length]!,
      transactions,
      logsBloom: toBloom(transactions.flatMap((t) => t.logs)),
      pools,
      minedAt,
      replacedAt: undefined,
    };
  }

  private generateTransaction({
    rng,
    number,
    fork,
    index,
    pools,
    logIndex,
  }: {
    rng: Rng;
    number: number;
    fork: number;
    index: number;
    pools: Address[];
    logIndex: number;
  }): SimTransaction {
    const hash = keccak256(
      toHex(`tx:${this.seed}:${this.plan.id}:${number}:${fork}:${index}`),
    );
    const from = rng.pick(EOAS);
    const kind = rng.weighted([
      ["transfer", 35],
      ["approve", 8],
      ["memo", 8],
      ["swap", pools.length > 0 ? 20 : 0],
      ["create", 6],
      ["native", 15],
      ["revert", 3],
    ] as const);

    const logs: Omit<SimLog, "logIndex">[] = [];
    let to: Address;
    let input: Hex;
    let value = 0n;
    let status: "0x1" | "0x0" = "0x1";
    const calls: Frame[] = [];
    let output: Hex | undefined = "0x";
    let error: string | undefined;

    const amount = () => BigInt(rng.int(1, 1_000_000)) * 10n ** 12n;
    const recipient = () => rng.pick([...EOAS, DEAD, zeroAddress]);
    const transferLog = (
      token: Address,
      a: Address,
      b: Address,
      v: bigint,
    ) => ({
      address: token,
      topics: encodeEventTopics({
        abi: tokenAbi,
        eventName: "Transfer",
        args: { from: a, to: b },
      }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [v]),
    });

    switch (kind) {
      case "transfer":
      case "revert": {
        to = rng.pick(this.tokens);
        const r = recipient();
        const v = amount();
        input = encodeFunctionData({
          abi: tokenAbi,
          functionName: "transfer",
          args: [r, v],
        });
        if (kind === "revert") {
          status = "0x0";
          output = undefined;
          error = "execution reverted";
        } else {
          output = encodeAbiParameters([{ type: "bool" }], [true]);
          // Note: Some transfers are mints.
          logs.push(transferLog(to, rng.bool(0.2) ? zeroAddress : from, r, v));
        }
        break;
      }
      case "approve": {
        to = rng.pick(this.tokens);
        const spender = rng.pick(EOAS);
        const v = amount();
        input = encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [spender, v],
        });
        output = encodeAbiParameters([{ type: "bool" }], [true]);
        logs.push({
          address: to,
          topics: encodeEventTopics({
            abi: tokenAbi,
            eventName: "Approval",
            args: { owner: from, spender },
          }) as Hex[],
          data: encodeAbiParameters([{ type: "uint256" }], [v]),
        });
        break;
      }
      case "memo": {
        to = rng.pick(this.tokens);
        const id = keccak256(toHex(`memo:${hash}`));
        const text = rng.pick(["", "hello", "ünïcödé ✓", "a".repeat(80)]);
        input = encodeFunctionData({
          abi: tokenAbi,
          functionName: "memo",
          args: [id, text],
        });
        output = encodeAbiParameters([{ type: "uint256" }], [BigInt(index)]);
        const memo = tokenAbi.find(
          (item) => item.type === "event" && item.name === "Memo",
        )!;
        logs.push({
          address: to,
          topics: encodeEventTopics({
            abi: tokenAbi,
            eventName: "Memo",
            args: { id },
          }) as Hex[],
          data: encodeAbiParameters(memo.inputs.slice(1) as any, [
            text,
            Array.from({ length: rng.int(0, 4) }, () => amount()),
            {
              account: rng.pick(EOAS),
              amount: BigInt(rng.int(0, 2 ** 31)),
              flag: rng.bool(),
            },
            rng.bool() ? "0x" : toHex(`data:${index}`),
            BigInt(rng.int(-1_000_000, 1_000_000)),
          ]),
        });
        break;
      }
      case "swap": {
        to = rng.pick(pools);
        const [token0, token1] = rng.shuffle(this.tokens);
        const r = rng.pick(EOAS);
        const amount0 = amount();
        const amount1 = amount();
        value = rng.bool(0.3) ? amount() : 0n;
        input = encodeFunctionData({
          abi: poolAbi,
          functionName: "swap",
          args: [r, amount0],
        });
        output = encodeAbiParameters(
          [{ type: "int256" }, { type: "int256" }],
          [amount0, -amount1],
        );
        logs.push(transferLog(token0!, to, r, amount0));
        logs.push(transferLog(token1!, r, to, amount1));
        logs.push({
          address: to,
          topics: encodeEventTopics({
            abi: poolAbi,
            eventName: "Sync",
          }) as Hex[],
          data: encodeAbiParameters(
            [{ type: "uint112" }, { type: "uint112" }],
            [amount0 * 7n, amount1 * 3n],
          ),
        });
        logs.push({
          address: to,
          topics: encodeEventTopics({
            abi: poolAbi,
            eventName: "Swap",
            args: { sender: from, recipient: r },
          }) as Hex[],
          data: encodeAbiParameters(
            [{ type: "int256" }, { type: "int256" }, { type: "uint160" }],
            [amount0, -amount1, BigInt(rng.int(1, 2 ** 40)) << 96n],
          ),
        });
        calls.push(
          {
            type: "STATICCALL",
            from: to,
            to: token0!,
            input: encodeFunctionData({
              abi: tokenAbi,
              functionName: "balanceOf",
              args: [to],
            }),
            output: encodeAbiParameters([{ type: "uint256" }], [amount0 * 9n]),
            gas: GAS,
            gasUsed: GAS / 4n,
          },
          {
            type: "CALL",
            from: to,
            to: token0!,
            input: encodeFunctionData({
              abi: tokenAbi,
              functionName: "transfer",
              args: [r, amount0],
            }),
            output: encodeAbiParameters([{ type: "bool" }], [true]),
            value: 0n,
            gas: GAS * 2n,
            gasUsed: GAS,
          },
        );
        if (value > 0n) {
          // Note: Forwards the value to the recipient, a native transfer
          // inside a trace.
          calls.push({
            type: "CALL",
            from: to,
            to: r,
            input: "0x",
            output: "0x",
            value,
            gas: GAS,
            gasUsed: GAS,
          });
        }
        break;
      }
      case "create": {
        to = this.factory;
        const [token0, token1] = rng.shuffle(this.tokens);
        const pool = getPoolAddress(hash);
        input = encodeFunctionData({
          abi: factoryAbi,
          functionName: "createPool",
          args: [token0!, token1!],
        });
        output = encodeAbiParameters([{ type: "address" }], [pool]);
        logs.push({
          address: to,
          topics: encodeEventTopics({
            abi: factoryAbi,
            eventName: "PoolCreated",
            args: { token0: token0!, token1: token1! },
          }) as Hex[],
          data: encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            [pool, BigInt(pools.length)],
          ),
        });
        logs.push({
          address: to,
          topics: encodeEventTopics({
            abi: factoryAbi,
            eventName: "Deployed",
            args: { child: pool, salt: rng.int(0, 2 ** 24 - 1) },
          }) as Hex[],
          data: "0x",
        });
        calls.push({
          type: "CREATE",
          from: to,
          to: pool,
          input: toHex(`initcode:${pool}`),
          output: toHex(`code:${pool}`),
          value: 0n,
          gas: GAS * 10n,
          gasUsed: GAS * 8n,
        });
        pools.push(pool);
        break;
      }
      case "native": {
        to = rng.pick([...EOAS, DEAD]);
        value = amount();
        input = "0x";
        output = "0x";
        break;
      }
    }

    const gasUsed = GAS + BigInt(logs.length) * 5_000n;
    const indexedLogs = logs.map((log, i) => ({
      ...log,
      address: log.address.toLowerCase() as Address,
      logIndex: logIndex + i,
    }));

    return {
      hash,
      index,
      from,
      to: to!,
      input: input!,
      value,
      nonce: number * 16 + index,
      gas: gasUsed * 2n,
      gasUsed,
      status,
      logs: indexedLogs,
      logsBloom: toBloom(indexedLogs),
      trace: {
        type: "CALL",
        from,
        to: to!,
        input: input!,
        output,
        value,
        gas: gasUsed * 2n,
        gasUsed,
        error,
        calls: calls.length > 0 && status === "0x1" ? calls : undefined,
      },
    };
  }
}

/** The canonical chain at a virtual time. */
export class ChainView {
  constructor(
    readonly chain: SimChain,
    readonly at: number,
  ) {}

  private visible(block: SimBlock) {
    return (
      block.minedAt <= this.at &&
      (block.replacedAt === undefined || block.replacedAt > this.at)
    );
  }

  /** The block `number` that is canonical at this time. */
  block(number: number): SimBlock | undefined {
    const versions = this.chain.versions[number];
    if (versions === undefined) return undefined;
    for (let i = versions.length - 1; i >= 0; i--) {
      if (this.visible(versions[i]!)) return versions[i];
    }
    return undefined;
  }

  get head(): SimBlock {
    for (let n = this.chain.versions.length - 1; n >= 0; n--) {
      const block = this.block(n);
      if (block) return block;
    }
    throw new Error("empty chain");
  }

  /** A block by hash. Replaced blocks are still known. */
  blockByHash(hash: Hex): SimBlock | undefined {
    const block = this.chain.blocksByHash.get(hash.toLowerCase() as Hex);
    if (block === undefined || block.minedAt > this.at) return undefined;
    return block;
  }

  /** A canonical transaction by hash. */
  transaction(hash: Hex) {
    const result = this.chain.transactionsByHash.get(hash.toLowerCase() as Hex);
    if (result === undefined || this.visible(result.block) === false) {
      return undefined;
    }
    return result;
  }

  /**
   * Resolve a block tag or number to a canonical block, or `undefined` if it
   * doesn't exist yet.
   */
  resolve(tag: unknown): SimBlock | undefined {
    if (tag === undefined || tag === "latest" || tag === "pending") {
      return this.head;
    }
    if (tag === "earliest") return this.block(0);
    if (tag === "safe" || tag === "finalized") {
      const head = this.head;
      return this.block(
        Math.max(
          0,
          head.number -
            Math.ceil(this.chain.plan.reorgWindow / this.chain.plan.blockTime),
        ),
      );
    }
    if (typeof tag === "string" && tag.startsWith("0x") && tag.length === 66) {
      return this.blockByHash(tag as Hex);
    }
    if (typeof tag === "object" && tag !== null && "blockHash" in tag) {
      return this.blockByHash((tag as { blockHash: Hex }).blockHash);
    }
    if (typeof tag === "object" && tag !== null && "blockNumber" in tag) {
      return this.block(Number((tag as { blockNumber: Hex }).blockNumber));
    }
    return this.block(Number(tag));
  }
}
