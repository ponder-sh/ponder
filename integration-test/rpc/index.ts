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
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "../../packages/core/src/utils/promiseWithResolvers.js";
import {
  ERROR_RATE,
  ETH_GET_LOGS_BLOCK_LIMIT,
  ETH_GET_LOGS_RESPONSE_LIMIT,
  REALTIME_DEEP_REORG_RATE,
  REALTIME_DELAY_RATE,
  REALTIME_FAST_FORWARD_RATE,
  REALTIME_REORG_RATE,
  SEED,
} from "../index.js";
import * as RPC_SCHEMA from "./schema.js";

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

      if (seedrandom(SEED + id + nonce)() < ERROR_RATE) {
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
          if (range > ETH_GET_LOGS_BLOCK_LIMIT) {
            // cloudflare error message
            throw new Error(`Max range: ${ETH_GET_LOGS_BLOCK_LIMIT}`);
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
              await db.insert(RPC_SCHEMA.blocks).values({
                chainId: chain!.id,
                number: hexToNumber(body.params[0]),
                // @ts-expect-error
                hash: result.hash,
                body: result,
              });
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
              await db.insert(RPC_SCHEMA.blocks).values({
                chainId: chain!.id,
                // @ts-expect-error
                number: hexToNumber(result.number),
                hash: body.params[0],
                body: result,
              });
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
                  const rpcLogs = await _request(body);
                  // @ts-expect-error
                  logs.push(...rpcLogs);
                  await db.insert(RPC_SCHEMA.logs).values({
                    chainId: chain!.id,
                    blockNumber: block,
                    body: rpcLogs,
                  });
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
                await db.insert(RPC_SCHEMA.logs).values({
                  chainId: chain!.id,
                  blockNumber: number,
                  body: rpcLogs,
                });
              }
            } else {
              throw new Error("Invariant broken. Invalid eth_getLogs request.");
            }

            // TODO(kyle) lowercase address
            if ("address" in body.params[0] && body.params[0].address) {
              if (Array.isArray(body.params[0].address)) {
                logs = logs.filter((log) =>
                  (body.params[0].address as Address[]).includes(log.address),
                );
              } else {
                logs = logs.filter(
                  (log) => body.params[0].address === log.address,
                );
              }
            }

            if ("topics" in body.params[0] && body.params[0].topics) {
              for (let i = 0; i < body.params[0].topics.length; i++) {
                if (Array.isArray(body.params[0].topics[i])) {
                  logs = logs.filter((log) =>
                    (body.params[0].topics[i] as Hash[]).includes(
                      log[`topic${i}`],
                    ),
                  );
                } else if (body.params[0].topics[i] !== null) {
                  logs = logs.filter(
                    (log) => body.params[0].topics[i] === log[`topic${i}`],
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

              await db.insert(RPC_SCHEMA.transactionReceipts).values({
                chainId: chain!.id,
                transactionHash: body.params[0],
                body: result,
              });
            }

            break;
          }
          case "eth_getBlockReceipts": {
            const receipt = await db
              .select()
              .from(RPC_SCHEMA.blockReceipts)
              .where(
                and(
                  eq(RPC_SCHEMA.blockReceipts.chainId, chain!.id),
                  eq(
                    RPC_SCHEMA.blockReceipts.blockNumber,
                    hexToNumber(body.params[0]),
                  ),
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

              await db.insert(RPC_SCHEMA.blockReceipts).values({
                chainId: chain!.id,
                blockNumber: hexToNumber(body.params[0]),
                body: result,
              });
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
              );

            if (traces.length > 0) {
              result = traces.map((trace) => trace.body);
            } else {
              result = await _request(body);
              await db.insert(RPC_SCHEMA.traces).values({
                chainId: chain!.id,
                number: hexToNumber(body.params[0]),
                body: result,
              });
            }

            break;
          }
          case "debug_traceBlockByHash": {
            const number = await db
              .select({ number: RPC_SCHEMA.blocks.number })
              .from(RPC_SCHEMA.blocks)
              .where(
                and(
                  eq(RPC_SCHEMA.blocks.chainId, chain!.id),
                  eq(RPC_SCHEMA.blocks.hash, body.params[0]),
                ),
              )
              .then((blocks) => blocks[0]!.number);

            const traces = await db
              .select({ body: RPC_SCHEMA.traces.body })
              .from(RPC_SCHEMA.traces)
              .where(
                and(
                  eq(RPC_SCHEMA.traces.chainId, chain!.id),
                  eq(RPC_SCHEMA.traces.number, number),
                ),
              );

            if (traces.length > 0) {
              result = traces.map((trace) => trace.body);
            } else {
              result = await _request(body);
              await db.insert(RPC_SCHEMA.traces).values({
                chainId: chain!.id,
                number,
                body: result,
              });
            }

            break;
          }
        }
      }

      if (result === undefined) {
        throw new Error("Simulation invariant broken. Result is undefined.");
      }

      if (body.method === "eth_getLogs") {
        if ((result as unknown[]).length > ETH_GET_LOGS_RESPONSE_LIMIT) {
          // optimism error message
          throw new Error("backend response too large");
        }
      }

      return result;
    };

    return custom({ request })({ chain, retryCount: 0 });
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

  const blocks = new Map<number, RpcBlock[]>();
  const isChainDone = new Map<number, boolean>();

  // TODO(kyle) block not found error

  const getBlock = async (
    chainId: number,
    blockNumber: number,
  ): Promise<RpcBlock> => {
    const block =
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
            .then((blocks) => blocks[0]);

    if (block) {
      return block.body as RpcBlock;
    } else {
      const result = await chains.get(chainId)!.request({
        method: "eth_getBlockByNumber",
        params: [toHex(blockNumber), true],
      });

      if (db) {
        await db.insert(RPC_SCHEMA.blocks).values({
          chainId,
          number: blockNumber,
          // @ts-expect-error
          hash: result.hash,
          body: result,
        });
      }

      return result as RpcBlock;
    }
  };

  const getNextBlock = async (chainId: number): Promise<RpcBlock> => {
    const currentBlock = blocks.get(chainId)![blocks.get(chainId)!.length - 1]!;
    const blockNumber = hexToNumber(currentBlock.number!) + 1;
    return getBlock(chainId, blockNumber);
  };

  const simulate = async (): Promise<
    { chainId: number; block: RpcBlock } | undefined
  > => {
    if (Array.from(isChainDone.values()).every((v) => v)) return undefined;

    const latestBlocks: [number, RpcBlock][] = [];
    for (const [chainId, _blocks] of blocks) {
      latestBlocks.push([chainId, _blocks[_blocks.length - 1]!]);
    }

    const orderedChainIds = latestBlocks
      .sort((a, b) =>
        hexToNumber(a[1].timestamp) < hexToNumber(b[1].timestamp) ? -1 : 1,
      )
      .map(([chainId]) => chainId);

    let random = seedrandom(
      SEED + latestBlocks.map((b) => b[1].number).join(""),
    );
    let chainId: number;
    for (let i = 0; i < orderedChainIds.length; i++) {
      if (random() < REALTIME_DELAY_RATE || i === orderedChainIds.length - 1) {
        chainId = orderedChainIds[i]!;
        break;
      }
    }

    // @ts-ignore
    if (chainId === undefined) {
      throw "never";
    }

    let block = latestBlocks.find((b) => b[0] === chainId)![1];
    const isEnd =
      chains.get(chainId)!.interval[1] === hexToNumber(block.number!);

    if (isEnd) {
      isChainDone.set(chainId, true);
      return { chainId, block };
    }

    const nextBlock = await getNextBlock(chainId);
    blocks.get(chainId)!.push(nextBlock);

    random = seedrandom(SEED + chainId + nextBlock.number);

    if (random() < REALTIME_FAST_FORWARD_RATE) {
      return simulate();
    }

    const r = random();
    if (r < REALTIME_REORG_RATE) {
      if (r < REALTIME_REORG_RATE / 2) {
        block = blocks.get(chainId)![blocks.get(chainId)!.length - 3]!;
      } else {
        const hash = `0x${crypto.randomBytes(32).toString("hex")}` as Hash;
        block = { ...block, hash, logsBloom: zeroLogsBloom };
      }
    } else if (random() < REALTIME_DEEP_REORG_RATE) {
      block = blocks.get(chainId)![1]!;
      const hash = `0x${crypto.randomBytes(32).toString("hex")}` as Hash;
      block = { ...block, hash, logsBloom: zeroLogsBloom };
    }

    return { chainId, block };
  };

  const startPwr = promiseWithResolvers<void>();
  const pwr = new Map<number, PromiseWithResolvers<RpcBlock>>();
  let startCount = 0;

  for (const [chainId, { interval }] of chains) {
    pwr.set(chainId, promiseWithResolvers<RpcBlock>());

    isChainDone.set(chainId, false);
    blocks.set(chainId, [await getBlock(chainId, interval[0])]);
    blocks.get(chainId)!.push(await getNextBlock(chainId));
  }

  return async function* (chainId: number) {
    startCount += 1;

    if (startCount === chains.size) {
      startPwr.resolve();
    } else {
      await startPwr.promise;
    }

    while (true) {
      const next = await simulate();

      if (next === undefined) return;

      if (chainId === next.chainId) {
        yield next.block;
      } else {
        pwr.get(next.chainId)!.resolve(next.block);
        pwr.set(next.chainId, promiseWithResolvers<RpcBlock>());
        yield await pwr.get(chainId)!.promise;
      }
    }
  };
};
