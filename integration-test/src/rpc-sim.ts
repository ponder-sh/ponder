import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import seedrandom from "seedrandom";
import {
  type Address,
  type Hash,
  type RpcBlock,
  type RpcLog,
  type Transport,
  custom,
  hexToNumber,
  toHex,
} from "viem";
import { zeroLogsBloom } from "../../packages/core/src/sync-realtime/bloom.js";
import { promiseWithResolvers } from "../../packages/core/src/utils/promiseWithResolvers.js";
import * as RPC_SCHEMA from "../schema.js";
import { SEED, SIM_PARAMS } from "./index.js";

const PONDER_RPC_METHODS = [
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_chainId",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "eth_getBlockReceipts",
  "debug_traceBlockByNumber",
  "debug_traceBlockByHash",
] as const;

/**
 * Simulated transport.
 *
 * @dev If `connectionString` is provided, rpc requests will be served from the "ponder_sync" schema.
 */
export const sim =
  (transport: Transport, connectionString?: string): Transport =>
  ({ chain }) => {
    const requestCount = new Map<string, number>();

    if (chain === undefined) {
      throw new Error("`chain` undefined");
    }

    const _request = transport({ chain }).request;
    const db = connectionString
      ? drizzle(connectionString, {
          casing: "snake_case",
          schema: RPC_SCHEMA,
        })
      : undefined;

    const request = async (body: any) => {
      if (PONDER_RPC_METHODS.includes(body.method) === false) {
        throw new Error("Unsupported method");
      }

      if (body.method === "eth_chainId") {
        return toHex(chain!.id);
      }

      // same request returns the same response, regardless of order
      const id = JSON.stringify(body);

      let nonce: number;
      if (requestCount.has(id)) {
        nonce = requestCount.get(id)!;
      } else {
        nonce = 0;
      }

      requestCount.set(id, nonce + 1);

      if (seedrandom(SEED + id + nonce)() < SIM_PARAMS.RPC_ERROR_RATE) {
        throw new Error("Simulated error");
      }

      // block tag validation

      switch (body.method) {
        case "eth_getBlockByNumber":
        case "eth_getBlockReceipts":
        case "debug_traceBlockByNumber":
          if (body.params[0] === "latest") {
            throw new Error("Block tag not supported");
          }
          break;
        case "eth_getLogs":
          if (
            body.params[0].fromBlock === "latest" ||
            body.params[0].toBlock === "latest"
          ) {
            throw new Error("Block tag not supported");
          }
          break;
      }

      // eth_getLogs block range validation

      if (body.method === "eth_getLogs") {
        if ("fromBlock" in body.params[0] && "toBlock" in body.params[0]) {
          const { fromBlock, toBlock } = body.params[0];
          const range = +toBlock - +fromBlock;
          if (range > SIM_PARAMS.ETH_GET_LOGS_BLOCK_LIMIT) {
            // cloudflare error message
            throw new Error(
              `Max range: ${SIM_PARAMS.ETH_GET_LOGS_BLOCK_LIMIT}`,
            );
          }
        }
      }

      let result: unknown;

      if (db) {
        switch (body.method) {
          case "eth_getBlockByNumber": {
            const block = await db
              .select({ body: RPC_SCHEMA.blocks.body })
              .from(RPC_SCHEMA.blocks)
              .where(
                and(
                  eq(RPC_SCHEMA.blocks.chainId, chain!.id),
                  eq(RPC_SCHEMA.blocks.number, hexToNumber(body.params[0])),
                ),
              )
              .then((blocks) => blocks[0]);

            if (block) {
              result = block.body;
            } else {
              result = await _request(body);
              await db
                .insert(RPC_SCHEMA.blocks)
                .values({
                  chainId: chain!.id,
                  number: hexToNumber(body.params[0]),
                  // @ts-expect-error
                  hash: result.hash,
                  body: result,
                })
                .onConflictDoNothing();
            }

            break;
          }
          case "eth_getBlockByHash": {
            const block = await db
              .select({ body: RPC_SCHEMA.blocks.body })
              .from(RPC_SCHEMA.blocks)
              .where(
                and(
                  eq(RPC_SCHEMA.blocks.chainId, chain!.id),
                  eq(RPC_SCHEMA.blocks.hash, body.params[0]),
                ),
              )
              .then((blocks) => blocks[0]);

            if (block) {
              result = block.body;
            } else {
              result = await _request(body);
              await db
                .insert(RPC_SCHEMA.blocks)
                .values({
                  chainId: chain!.id,
                  // @ts-expect-error
                  number: hexToNumber(result.number),
                  hash: body.params[0],
                  body: result,
                })
                .onConflictDoNothing();
            }

            break;
          }
          case "eth_getLogs": {
            let logs: RpcLog[] = [];

            if ("fromBlock" in body.params[0] && "toBlock" in body.params[0]) {
              for (
                let block = +body.params[0].fromBlock;
                block <= +body.params[0].toBlock;
                block++
              ) {
                const _logs = await db
                  .select({ body: RPC_SCHEMA.logs.body })
                  .from(RPC_SCHEMA.logs)
                  .where(
                    and(
                      eq(RPC_SCHEMA.logs.chainId, chain!.id),
                      eq(RPC_SCHEMA.logs.blockNumber, block),
                    ),
                  )
                  .then((logs) => logs[0]);

                if (_logs) {
                  logs.push(...(_logs.body as RpcLog[]));
                } else {
                  const rpcLogs = await _request({
                    method: "eth_getLogs",
                    params: [
                      {
                        fromBlock: toHex(block),
                        toBlock: toHex(block),
                      },
                    ],
                  });
                  // @ts-expect-error
                  logs.push(...rpcLogs);
                  await db
                    .insert(RPC_SCHEMA.logs)
                    .values({
                      chainId: chain!.id,
                      blockNumber: block,
                      body: rpcLogs,
                    })
                    .onConflictDoNothing();
                }
              }
            } else if ("blockHash" in body.params[0]) {
              const block = await db
                .select({ number: RPC_SCHEMA.blocks.number })
                .from(RPC_SCHEMA.blocks)
                .where(
                  and(
                    eq(RPC_SCHEMA.blocks.chainId, chain!.id),
                    eq(RPC_SCHEMA.blocks.hash, body.params[0].blockHash),
                  ),
                )
                .then((blocks) => blocks[0]);

              // block won't be in db if it's a reorg
              if (block === undefined) {
                result = [];
                break;
              }

              const number = block.number;

              const _logs = await db
                .select({ body: RPC_SCHEMA.logs.body })
                .from(RPC_SCHEMA.logs)
                .where(
                  and(
                    eq(RPC_SCHEMA.logs.chainId, chain!.id),
                    eq(RPC_SCHEMA.logs.blockNumber, number),
                  ),
                )
                .then((logs) => logs[0]);

              if (_logs) {
                logs.push(...(_logs.body as RpcLog[]));
              } else {
                const rpcLogs = await _request(body);
                // @ts-expect-error
                logs.push(...rpcLogs);
                await db
                  .insert(RPC_SCHEMA.logs)
                  .values({
                    chainId: chain!.id,
                    blockNumber: number,
                    body: rpcLogs,
                  })
                  .onConflictDoNothing();
              }
            } else {
              throw new Error("Invariant broken. Invalid eth_getLogs request.");
            }

            if ("address" in body.params[0] && body.params[0].address) {
              if (Array.isArray(body.params[0].address)) {
                logs = logs.filter((log) =>
                  (body.params[0].address as Address[]).some(
                    (address) =>
                      address.toLowerCase() === log.address.toLowerCase(),
                  ),
                );
              } else {
                logs = logs.filter(
                  (log) =>
                    body.params[0].address.toLowerCase() ===
                    log.address.toLowerCase(),
                );
              }
            }

            if ("topics" in body.params[0] && body.params[0].topics) {
              for (let i = 0; i < body.params[0].topics.length; i++) {
                if (Array.isArray(body.params[0].topics[i])) {
                  logs = logs.filter((log) =>
                    (body.params[0].topics[i] as Hash[]).includes(
                      log.topics[i]!,
                    ),
                  );
                } else if (body.params[0].topics[i] !== null) {
                  logs = logs.filter(
                    (log) => body.params[0].topics[i] === log.topics[i]!,
                  );
                }
              }
            }

            result = logs;

            break;
          }
          case "eth_getTransactionReceipt": {
            const receipt = await db
              .select()
              .from(RPC_SCHEMA.transactionReceipts)
              .where(
                and(
                  eq(RPC_SCHEMA.transactionReceipts.chainId, chain!.id),
                  eq(
                    RPC_SCHEMA.transactionReceipts.transactionHash,
                    body.params[0],
                  ),
                ),
              )
              .then((receipts) => receipts[0]);

            if (receipt) {
              result = receipt.body;
            } else {
              result = await _request(body);
              // @ts-ignore
              result.logs = undefined;

              await db
                .insert(RPC_SCHEMA.transactionReceipts)
                .values({
                  chainId: chain!.id,
                  transactionHash: body.params[0],
                  body: result,
                })
                .onConflictDoNothing();
            }

            break;
          }
          case "eth_getBlockReceipts": {
            // Note: this assumes all eth_getBlockReceipts requests use block hash.
            const receipt = await db
              .select()
              .from(RPC_SCHEMA.blockReceipts)
              .where(
                and(
                  eq(RPC_SCHEMA.blockReceipts.chainId, chain!.id),
                  eq(RPC_SCHEMA.blockReceipts.blockHash, body.params[0]),
                ),
              )
              .then((receipts) => receipts[0]);

            if (receipt) {
              result = receipt.body;
            } else {
              result = await _request(body);
              // @ts-ignore
              for (const receipt of result) {
                receipt.logs = undefined;
              }

              await db
                .insert(RPC_SCHEMA.blockReceipts)
                .values({
                  chainId: chain!.id,
                  blockHash: body.params[0],
                  body: result,
                })
                .onConflictDoNothing();
            }

            break;
          }
          case "debug_traceBlockByNumber": {
            const traces = await db
              .select({ body: RPC_SCHEMA.traces.body })
              .from(RPC_SCHEMA.traces)
              .where(
                and(
                  eq(RPC_SCHEMA.traces.chainId, chain!.id),
                  eq(RPC_SCHEMA.traces.number, hexToNumber(body.params[0])),
                ),
              )
              .then((traces) => traces[0]);

            if (traces) {
              result = traces.body;
            } else {
              result = await _request(body);
              await db
                .insert(RPC_SCHEMA.traces)
                .values({
                  chainId: chain!.id,
                  number: hexToNumber(body.params[0]),
                  body: JSON.stringify(result).replace(/\0/g, ""),
                })
                .onConflictDoNothing();
            }

            break;
          }
          case "debug_traceBlockByHash": {
            const block = await db
              .select({ number: RPC_SCHEMA.blocks.number })
              .from(RPC_SCHEMA.blocks)
              .where(
                and(
                  eq(RPC_SCHEMA.blocks.chainId, chain!.id),
                  eq(RPC_SCHEMA.blocks.hash, body.params[0]),
                ),
              )
              .then((blocks) => blocks[0]);

            // block won't be in db if it's a reorg
            if (block === undefined) {
              result = [];
              break;
            }

            const number = block.number;

            const traces = await db
              .select({ body: RPC_SCHEMA.traces.body })
              .from(RPC_SCHEMA.traces)
              .where(
                and(
                  eq(RPC_SCHEMA.traces.chainId, chain!.id),
                  eq(RPC_SCHEMA.traces.number, number),
                ),
              )
              .then((traces) => traces[0]);

            if (traces) {
              result = traces.body;
            } else {
              result = await _request(body);
              await db
                .insert(RPC_SCHEMA.traces)
                .values({
                  chainId: chain!.id,
                  number,
                  body: JSON.stringify(result).replace(/\0/g, ""),
                })
                .onConflictDoNothing();
            }

            break;
          }
        }
      }

      if (result === undefined) {
        throw new Error("Simulation invariant broken. Result is undefined.");
      }

      if (
        body.method === "eth_getLogs" &&
        body.params[0].blockHash === undefined
      ) {
        if (
          (result as unknown[]).length > SIM_PARAMS.ETH_GET_LOGS_RESPONSE_LIMIT
        ) {
          // optimism error message
          throw new Error("backend response too large");
        }
      }

      return result;
    };

    return custom({ request })({ chain, retryCount: 0 });
  };

export type RpcBlockHeader = Omit<RpcBlock, "transactions"> & {
  transactions: Address[] | undefined;
};

export const realtimeBlockEngine = async (
  chains: Map<
    number,
    { request: ReturnType<Transport>["request"]; interval: [number, number] }
  >,
  connectionString?: string,
) => {
  const db = connectionString
    ? drizzle(connectionString, {
        casing: "snake_case",
        schema: RPC_SCHEMA,
      })
    : undefined;

  const blocks = new Map<number, (RpcBlock | RpcBlockHeader)[]>();
  const incomplete = new Set<number>();

  // TODO(kyle) block not found error

  const getBlock = async (
    chainId: number,
    blockNumber: number,
  ): Promise<RpcBlock | RpcBlockHeader> => {
    let block: RpcBlockHeader | RpcBlock | undefined =
      db === undefined
        ? undefined
        : await db
            .select({ body: RPC_SCHEMA.blocks.body })
            .from(RPC_SCHEMA.blocks)
            .where(
              and(
                eq(RPC_SCHEMA.blocks.chainId, chainId),
                eq(RPC_SCHEMA.blocks.number, blockNumber),
              ),
            )
            .then((blocks) => blocks[0]?.body as RpcBlock);

    if (block === undefined) {
      const result = await chains.get(chainId)!.request({
        method: "eth_getBlockByNumber",
        params: [toHex(blockNumber), true],
      });

      if (db) {
        await db
          .insert(RPC_SCHEMA.blocks)
          .values({
            chainId,
            number: blockNumber,
            // @ts-expect-error
            hash: result.hash,
            body: result,
          })
          .onConflictDoNothing();
      }

      block = result as RpcBlock;
    }

    if (SIM_PARAMS.REALTIME_BLOCK_HAS_TRANSACTIONS === false) {
      block.transactions = undefined;
    }

    return block;
  };

  const getNextBlock = async (
    chainId: number,
  ): Promise<RpcBlock | RpcBlockHeader> => {
    const currentBlock = blocks.get(chainId)![blocks.get(chainId)!.length - 1]!;
    const blockNumber = hexToNumber(currentBlock.number!) + 1;
    return getBlock(chainId, blockNumber);
  };

  const simulate = async (
    chainId: number,
  ): Promise<RpcBlock | RpcBlockHeader | undefined> => {
    if (incomplete.has(chainId) === false) return undefined;

    let block = blocks.get(chainId)![blocks.get(chainId)!.length - 1]!;
    const isEnd =
      chains.get(chainId)!.interval[1] === hexToNumber(block.number!);
    const isNextEnd =
      chains.get(chainId)!.interval[1] === hexToNumber(block.number!) + 1;

    if (isEnd) {
      incomplete.delete(chainId);
      return block;
    }

    const nextBlock = await getNextBlock(chainId);
    blocks.get(chainId)!.push(nextBlock);

    if (isNextEnd) {
      return block;
    }

    const random = seedrandom(SEED + chainId + nextBlock.number);

    // if (random() < SIM_PARAMS.REALTIME_SHUTDOWN_RATE) {
    //   await restart();
    // }

    if (random() < SIM_PARAMS.REALTIME_FAST_FORWARD_RATE) {
      return simulate(chainId);
    }

    const r = random();
    if (r < SIM_PARAMS.REALTIME_REORG_RATE) {
      if (r < SIM_PARAMS.REALTIME_REORG_RATE / 2) {
        block = blocks.get(chainId)![blocks.get(chainId)!.length - 3]!;
      } else {
        const hash = `0x${crypto.randomBytes(32).toString("hex")}` as Hash;
        block = { ...block, hash, logsBloom: zeroLogsBloom, transactions: [] };
      }
    } else if (random() < SIM_PARAMS.REALTIME_DEEP_REORG_RATE) {
      block = blocks.get(chainId)![1]!;
      const hash = `0x${crypto.randomBytes(32).toString("hex")}` as Hash;
      block = { ...block, hash, logsBloom: zeroLogsBloom, transactions: [] };
    }

    return block;
  };

  for (const [chainId, { interval }] of chains) {
    incomplete.add(chainId);
    blocks.set(chainId, [await getBlock(chainId, interval[0])]);
    blocks.get(chainId)!.push(await getNextBlock(chainId));
  }

  if (SIM_PARAMS.ORDERING === "multichain") {
    // Note: better interchain determinism is possible for "multichain" ordering
    // if we only allow one chain to yield at a time.

    const random = seedrandom(`${SEED}_leader`);
    let pwr = promiseWithResolvers<void>();
    let leader =
      Array.from(incomplete)[Math.floor(random() * incomplete.size)]!;
    return async function* (chainId: number) {
      while (true) {
        if (leader === undefined || leader === chainId) {
          const next = await simulate(chainId);

          if (next) yield next;

          leader =
            Array.from(incomplete)[Math.floor(random() * incomplete.size)]!;
          pwr.resolve();
          pwr = promiseWithResolvers<void>();

          if (next === undefined) return;
        } else {
          await pwr.promise;
        }
      }
    };
  } else {
    return async function* (chainId: number) {
      let next = await simulate(chainId);
      while (true) {
        const promise = simulate(chainId);
        if (next === undefined) return;
        yield next;
        next = await promise;
      }
    };
  }
};
