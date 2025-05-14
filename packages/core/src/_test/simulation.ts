import crypto from "node:crypto";
import { zeroLogsBloom } from "@/sync-realtime/bloom.js";
import * as PONDER_SYNC_SCHEMA from "@/sync-store/schema.js";
import type { Trace } from "@/utils/debug.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import { type SQL, and, desc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import seedrandom from "seedrandom";
import {
  type Hash,
  type Hex,
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  type RpcTransactionReceipt,
  type Transport,
  checksumAddress,
  custom,
  hexToBigInt,
  hexToNumber,
  toHex,
  zeroAddress,
} from "viem";

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

const shouldMockBlocks = false;
const blocksByNumber = new Map<
  number,
  Map<number, { hash: Hash; timestamp: Hex }>
>();
const blocksByHash = new Map<number, Map<Hash, number>>();

// TODO(kyle) add noise in responses like extra transactions, etc.

/**
 * Simulated transport.
 *
 * @dev If `connectionString` is provided, rpc requests will be served from the "ponder_sync" schema.
 */
export const sim =
  (
    transport: Transport,
    params: {
      SEED: string;
      ERROR_RATE: number;
      ETH_GET_LOGS_RESPONSE_LIMIT: number;
      ETH_GET_LOGS_BLOCK_LIMIT: number;
    },
    connectionString?: string,
  ): Transport =>
  ({ chain }) => {
    const requestCount = new Map<string, number>();

    const _request = transport({ chain }).request;
    const db = connectionString
      ? drizzle(connectionString, {
          casing: "snake_case",
          schema: PONDER_SYNC_SCHEMA,
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

      if (seedrandom(params.SEED + id + nonce)() < params.ERROR_RATE) {
        throw new Error("Simulated error");
      }

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

      if (body.method === "eth_getLogs") {
        if ("fromBlock" in body.params[0] && "toBlock" in body.params[0]) {
          const { fromBlock, toBlock } = body.params[0];
          const range = +toBlock - +fromBlock;
          if (range > params.ETH_GET_LOGS_BLOCK_LIMIT) {
            // cloudflare error message
            throw new Error(`Max range: ${params.ETH_GET_LOGS_BLOCK_LIMIT}`);
          }
        }
      }

      let result: unknown;

      if (db) {
        switch (body.method) {
          case "eth_getBlockByNumber": {
            const blocks = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.blocks)
              .where(
                and(
                  eq(PONDER_SYNC_SCHEMA.blocks.chainId, BigInt(chain!.id)),
                  eq(
                    PONDER_SYNC_SCHEMA.blocks.number,
                    hexToBigInt(body.params[0]),
                  ),
                ),
              );

            if (blocks.length === 0) {
              if (shouldMockBlocks === false) {
                result = await _request(body).then((block) =>
                  sanitizeLogsBloom(db, chain!.id, block as RpcBlock),
                );
                break;
              }

              // Use block metadata to create a mock block.

              const metadata = blocksByNumber
                .get(chain!.id)!
                .get(hexToNumber(body.params[0]));
              const parentMetadata = blocksByNumber
                .get(chain!.id)!
                .get(hexToNumber(body.params[0]) - 1);

              if (metadata === undefined) {
                throw new Error(
                  `Block metadata not found for block ${hexToNumber(body.params[0])}`,
                );
              }

              if (parentMetadata === undefined) {
                throw new Error(
                  `Block metadata not found for block ${hexToNumber(body.params[0]) - 1}`,
                );
              }

              result = {
                number: body.params[0],
                timestamp: metadata.timestamp,
                hash: metadata.hash,
                parentHash: parentMetadata.hash,
                transactions: [],
                logsBloom: zeroLogsBloom,
                miner: zeroAddress,
                gasLimit: "0x0",
                gasUsed: "0x0",
                baseFeePerGas: "0x0",
                blobGasUsed: "0x0",
                excessBlobGas: "0x0",
                nonce: "0x0",
                mixHash: "0x",
                stateRoot: "0x",
                receiptsRoot: "0x",
                transactionsRoot: "0x",
                difficulty: "0x0",
                totalDifficulty: "0x0",
                size: "0x0",
                extraData: "0x",
                sealFields: [],
                uncles: [],
                sha3Uncles: "0x",
              } satisfies RpcBlock;

              break;
            }

            const transactions = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.transactions)
              .where(
                and(
                  eq(
                    PONDER_SYNC_SCHEMA.transactions.chainId,
                    BigInt(chain!.id),
                  ),
                  eq(
                    PONDER_SYNC_SCHEMA.transactions.blockNumber,
                    hexToBigInt(body.params[0]),
                  ),
                ),
              );

            result = decodeBlock(blocks[0]!);
            // @ts-ignore
            result.transactions = transactions.map(decodeTransaction);

            result = await sanitizeLogsBloom(db, chain!.id, result as RpcBlock);

            break;
          }
          case "eth_getBlockByHash": {
            const blocks = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.blocks)
              .where(
                and(
                  eq(PONDER_SYNC_SCHEMA.blocks.chainId, BigInt(chain!.id)),
                  eq(PONDER_SYNC_SCHEMA.blocks.hash, body.params[0]),
                ),
              );

            if (blocks.length === 0) {
              if (shouldMockBlocks === false) {
                result = await _request(body);
                break;
              }

              // Complete the eth_getBlockByNumber by looking up the block hash and substituting
              // in the correct block number.

              if (blocksByHash.has(body.params[0]) === false) {
                throw new Error(
                  `Invariant violation: block '${body.params[0]}' not found`,
                );
              }

              const number = blocksByHash.get(chain!.id)!.get(body.params[0])!;

              result = await request({
                method: "eth_getBlockByNumber",
                params: [toHex(number), true],
              });
              break;
            }

            const transactions = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.transactions)
              .where(
                and(
                  eq(
                    PONDER_SYNC_SCHEMA.transactions.chainId,
                    BigInt(chain!.id),
                  ),
                  eq(PONDER_SYNC_SCHEMA.transactions.blockHash, body.params[0]),
                ),
              );

            result = decodeBlock(blocks[0]!);
            // @ts-ignore
            result.transactions = transactions.map(decodeTransaction);

            break;
          }
          case "eth_getLogs": {
            const conditions: SQL[] = [];

            conditions.push(
              eq(PONDER_SYNC_SCHEMA.logs.chainId, BigInt(chain!.id)),
            );

            if ("fromBlock" in body.params[0] && "toBlock" in body.params[0]) {
              conditions.push(
                and(
                  gte(
                    PONDER_SYNC_SCHEMA.logs.blockNumber,
                    hexToBigInt(body.params[0].fromBlock),
                  ),
                  lte(
                    PONDER_SYNC_SCHEMA.logs.blockNumber,
                    hexToBigInt(body.params[0].toBlock),
                  ),
                )!,
              );
            }

            if ("blockHash" in body.params[0]) {
              conditions.push(
                eq(PONDER_SYNC_SCHEMA.logs.blockHash, body.params[0].blockHash),
              );
            }

            if ("address" in body.params[0] && body.params[0].address) {
              if (Array.isArray(body.params[0].address)) {
                conditions.push(
                  inArray(
                    PONDER_SYNC_SCHEMA.logs.address,
                    body.params[0].address,
                  ),
                );
              } else {
                conditions.push(
                  eq(PONDER_SYNC_SCHEMA.logs.address, body.params[0].address),
                );
              }
            }

            if ("topics" in body.params[0] && body.params[0].topics) {
              for (let i = 0; i < body.params[0].topics.length; i++) {
                if (Array.isArray(body.params[0].topics[i])) {
                  conditions.push(
                    inArray(
                      // @ts-expect-error
                      PONDER_SYNC_SCHEMA.logs[`topic${i}`],
                      body.params[0].topics[i],
                    ),
                  );
                } else if (body.params[0].topics[i] !== null) {
                  conditions.push(
                    eq(
                      // @ts-expect-error
                      PONDER_SYNC_SCHEMA.logs[`topic${i}`],
                      body.params[0].topics[i],
                    ),
                  );
                }
              }
            }

            result = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.logs)
              .where(and(...conditions))
              .then((logs) => logs.map((log) => decodeLog(log)));

            break;
          }
          case "eth_getTransactionReceipt": {
            const receipts = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.transactionReceipts)
              .where(
                eq(
                  PONDER_SYNC_SCHEMA.transactionReceipts.transactionHash,
                  body.params[0],
                ),
              );

            if (receipts.length === 0) {
              throw new Error(
                `Simulation invariant broken. Transaction receipt ${body.params[0]} not found.`,
              );
            }

            result = decodeTransactionReceipt(receipts[0]!);
            break;
          }
          case "eth_getBlockReceipts": {
            const receipts = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.transactionReceipts)
              .where(
                eq(
                  PONDER_SYNC_SCHEMA.transactionReceipts.blockNumber,
                  hexToBigInt(body.params[0]),
                ),
              );

            result = receipts.map(decodeTransactionReceipt);
            break;
          }
          case "debug_traceBlockByNumber": {
            const traces = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.traces)
              .where(
                eq(
                  PONDER_SYNC_SCHEMA.traces.blockNumber,
                  hexToBigInt(body.params[0]),
                ),
              );

            const tracesByTransactionIndex = new Map<
              number,
              Trace["result"][]
            >();

            for (const trace of traces) {
              if (
                tracesByTransactionIndex.has(trace.transactionIndex) === false
              ) {
                tracesByTransactionIndex.set(trace.transactionIndex, []);
              }
              tracesByTransactionIndex
                .get(trace.transactionIndex)!
                .push(decodeTrace(trace));
            }

            const transactionHashes: {
              transactionHash: Hash;
              transactionIndex: number;
            }[] = await db
              .select({
                transactionHash: PONDER_SYNC_SCHEMA.transactions.hash,
                transactionIndex:
                  PONDER_SYNC_SCHEMA.transactions.transactionIndex,
              })
              .from(PONDER_SYNC_SCHEMA.transactions)
              .where(
                and(
                  eq(
                    PONDER_SYNC_SCHEMA.transactions.chainId,
                    BigInt(chain!.id),
                  ),
                  inArray(
                    PONDER_SYNC_SCHEMA.transactions.transactionIndex,
                    Array.from(tracesByTransactionIndex.keys()),
                  ),
                ),
              );

            result = [];

            // Note: We don't have all the information to perfectly recreate the rpc response.
            // We simply with a flat tree structure, with one root and the rest of the calls as direct children.

            for (const [transactionIndex, traces] of tracesByTransactionIndex) {
              const transactionHash = transactionHashes.find(
                (transactionHash) =>
                  transactionHash.transactionIndex === transactionIndex,
              )!.transactionHash;

              if (traces.length > 1) {
                traces[0]!.calls = traces.slice(1);
              }

              // @ts-ignore
              result.push({ txHash: transactionHash, result: traces[0] });
            }

            // Note: in retrospect, we should have included a transaction_hash and parent_index column in the traces table
            // and then we could perfectly recreate the rpc request.

            break;
          }
          case "debug_traceBlockByHash": {
            const blocks = await db
              .select({ number: PONDER_SYNC_SCHEMA.blocks.number })
              .from(PONDER_SYNC_SCHEMA.blocks)
              .where(eq(PONDER_SYNC_SCHEMA.blocks.hash, body.params[0]));

            if (blocks.length === 0) {
              throw new Error(
                `Simulation invariant broken. Block ${body.params[0]} not found.`,
              );
            }

            const traces = await db
              .select()
              .from(PONDER_SYNC_SCHEMA.traces)
              .where(
                eq(PONDER_SYNC_SCHEMA.traces.blockNumber, blocks[0]!.number),
              );

            const tracesByTransactionIndex = new Map<
              number,
              Trace["result"][]
            >();

            for (const trace of traces) {
              if (
                tracesByTransactionIndex.has(trace.transactionIndex) === false
              ) {
                tracesByTransactionIndex.set(trace.transactionIndex, []);
              }
              tracesByTransactionIndex
                .get(trace.transactionIndex)!
                .push(decodeTrace(trace));
            }

            const transactionHashes: {
              transactionHash: Hash;
              transactionIndex: number;
            }[] = await db
              .select({
                transactionHash: PONDER_SYNC_SCHEMA.transactions.hash,
                transactionIndex:
                  PONDER_SYNC_SCHEMA.transactions.transactionIndex,
              })
              .from(PONDER_SYNC_SCHEMA.transactions)
              .where(
                and(
                  eq(
                    PONDER_SYNC_SCHEMA.transactions.chainId,
                    BigInt(chain!.id),
                  ),
                  inArray(
                    PONDER_SYNC_SCHEMA.transactions.transactionIndex,
                    Array.from(tracesByTransactionIndex.keys()),
                  ),
                ),
              );

            result = [];

            // Note: We don't have all the information to perfectly recreate the rpc response.
            // We simply with a flat tree structure, with one root and the rest of the calls as direct children.

            for (const [transactionIndex, traces] of tracesByTransactionIndex) {
              const transactionHash = transactionHashes.find(
                (transactionHash) =>
                  transactionHash.transactionIndex === transactionIndex,
              )!.transactionHash;

              if (traces.length > 1) {
                traces[0]!.calls = traces.slice(1);
              }

              // @ts-ignore
              result.push({ txHash: transactionHash, result: traces[0] });
            }

            // Note: in retrospect, we should have included a transaction_hash and parent_index column in the traces table
            // and then we could perfectly recreate the rpc request.

            break;
          }
        }
      }

      if (result === undefined) {
        result = await _request(body);
      }

      if (body.method === "eth_getLogs") {
        if ((result as unknown[]).length > params.ETH_GET_LOGS_RESPONSE_LIMIT) {
          // optimism error message
          throw new Error("backend response too large");
        }
      }

      return result;
    };

    return custom({ request })({ chain, retryCount: 0 });
  };

export const realtimeBlockEngine = (
  chains: Map<number, { request: ReturnType<Transport>["request"] }>,
  params: {
    SEED: string;
    REALTIME_REORG_RATE: number;
    REALTIME_FAST_FORWARD_RATE: number;
    REALTIME_DELAY_RATE: number;
  },
  connectionString?: string,
) => {
  const random = seedrandom(params.SEED);
  const blockPerChain = new Map<number, RpcBlock>();
  const finalizedPerChain = new Map<number, number>();
  const db = connectionString
    ? drizzle(connectionString, {
        casing: "snake_case",
        schema: PONDER_SYNC_SCHEMA,
      })
    : undefined;

  for (const [id] of chains) {
    blocksByNumber.set(id, new Map());
    blocksByHash.set(id, new Map());
  }

  // TODO(kyle) block not found error

  const getBlock = async (
    chainId: number,
    blockNumber: number,
  ): Promise<RpcBlock> => {
    if (db) {
      const blocks = await db
        .select()
        .from(PONDER_SYNC_SCHEMA.blocks)
        .where(
          and(
            eq(PONDER_SYNC_SCHEMA.blocks.chainId, BigInt(chainId)),
            eq(PONDER_SYNC_SCHEMA.blocks.number, BigInt(blockNumber)),
          ),
        );
      // const nextBlock = await db
      //   .select()
      //   .from(PONDER_SYNC_SCHEMA.blocks)
      //   .where(
      //     and(
      //       eq(PONDER_SYNC_SCHEMA.blocks.chainId, BigInt(chainId)),
      //       gt(PONDER_SYNC_SCHEMA.blocks.number, BigInt(blockNumber)),
      //     ),
      //   )
      //   .orderBy(desc(PONDER_SYNC_SCHEMA.blocks.number))
      //   .limit(1)
      //   .then((blocks) => (blocks.length === 0 ? undefined : blocks[0]));

      if (blocks.length === 0) {
        // const previousBlock = blockPerChain.get(chainId);

        // if (previousBlock) {
        //   if (hexToNumber(previousBlock.number!) !== blockNumber - 1) {
        //     // TODO(kyle) reorg
        //   }

        //   // Optimization for skipping rpc requests when the block
        //   // is not found in the db. The mocked blocks must have a proper
        //   // hash chain.

        //   let hash: Hash;

        //   if (nextBlock?.number === BigInt(blockNumber + 1)) {
        //     hash = nextBlock.parentHash;
        //   } else {
        //     hash = `0x${crypto.randomBytes(32).toString("hex")}` as Hash;
        //   }

        //   const timestamp = nextBlock
        //     ? toHex(
        //         Number(previousBlock.timestamp) +
        //           Math.round(
        //             ((Number(nextBlock.timestamp) -
        //               Number(previousBlock.timestamp)) /
        //               (Number(nextBlock.number) -
        //                 Number(previousBlock.number))) *
        //               (blockNumber - Number(previousBlock.number)),
        //           ),
        //       )
        //     : toHex(
        //         previousBlock.timestamp +
        //           (BigInt(blockNumber) - hexToBigInt(previousBlock.timestamp)),
        //       );

        //   blocksByNumber.get(chainId)!.set(blockNumber, {
        //     hash,
        //     timestamp,
        //   });
        //   blocksByHash.get(chainId)!.set(hash, blockNumber);

        //   return {
        //     number: toHex(blockNumber),
        //     timestamp: nextBlock
        //       ? toHex(
        //           Number(previousBlock.timestamp) +
        //             Math.round(
        //               ((Number(nextBlock.timestamp) -
        //                 Number(previousBlock.timestamp)) /
        //                 (Number(nextBlock.number) -
        //                   Number(previousBlock.number))) *
        //                 (blockNumber - Number(previousBlock.number)),
        //             ),
        //         )
        //       : toHex(
        //           previousBlock.timestamp +
        //             (BigInt(blockNumber) -
        //               hexToBigInt(previousBlock.timestamp)),
        //         ),
        //     hash,
        //     parentHash: previousBlock.hash!,
        //     transactions: [],
        //     logsBloom: zeroLogsBloom,
        //     miner: zeroAddress,
        //     gasLimit: "0x0",
        //     gasUsed: "0x0",
        //     baseFeePerGas: "0x0",
        //     blobGasUsed: "0x0",
        //     excessBlobGas: "0x0",
        //     nonce: "0x0",
        //     mixHash: "0x",
        //     stateRoot: "0x",
        //     receiptsRoot: "0x",
        //     transactionsRoot: "0x",
        //     difficulty: "0x0",
        //     totalDifficulty: "0x0",
        //     size: "0x0",
        //     extraData: "0x",
        //     sealFields: [],
        //     uncles: [],
        //     sha3Uncles: "0x",
        //   } satisfies RpcBlock;
        // } else {
        // Note: this path happens on startup
        const block = await chains
          .get(chainId)!
          .request({
            method: "eth_getBlockByNumber",
            params: [toHex(blockNumber), true],
          })
          .then((block) => sanitizeLogsBloom(db, chainId, block as RpcBlock));

        // @ts-ignore
        blocksByHash.get(chainId)!.set(block.hash!, blockNumber);

        return block as RpcBlock;
        // }
      }

      const transactions = await db
        .select()
        .from(PONDER_SYNC_SCHEMA.transactions)
        .where(
          and(
            eq(PONDER_SYNC_SCHEMA.transactions.chainId, BigInt(chainId)),
            eq(
              PONDER_SYNC_SCHEMA.transactions.blockNumber,
              BigInt(blockNumber),
            ),
          ),
        );

      let block = decodeBlock(blocks[0]!);
      // @ts-ignore
      block.transactions = transactions.map(decodeTransaction);

      blocksByHash.get(chainId)!.set(block.hash!, blockNumber);

      // @ts-ignore
      block = sanitizeLogsBloom(db, chainId, block as RpcBlock);

      return block as RpcBlock;
    }

    // @ts-ignore
    return chains.get(chainId)!.request({
      method: "eth_getBlockByNumber",
      params: [toHex(blockNumber), true],
    });
  };

  const calculateNextBlock = async (): Promise<
    { chainId: number; block: RpcBlock } | undefined
  > => {
    const timestampOrder = Array.from(blockPerChain.entries())
      .sort((a, b) =>
        hexToNumber(a[1].timestamp) < hexToNumber(b[1].timestamp) ? -1 : 1,
      )
      .map(([chainId]) => chainId);

    let chainId: number;
    for (let i = 0; i < timestampOrder.length; i++) {
      if (
        random() < params.REALTIME_DELAY_RATE ||
        i === timestampOrder.length - 1
      ) {
        chainId = timestampOrder[i]!;
        break;
      }
    }

    if (random() < params.REALTIME_FAST_FORWARD_RATE) {
      blockPerChain.set(
        chainId!,
        await getBlock(
          chainId!,
          hexToNumber(blockPerChain.get(chainId!)!.number!) + 1,
        ),
      );

      return calculateNextBlock();
    }

    let block = blockPerChain.get(chainId!)!;

    const r = random();
    if (r < params.REALTIME_REORG_RATE) {
      blockPerChain.set(chainId!, block);

      const hash = `0x${crypto.randomBytes(32).toString("hex")}` as Hash;
      if (db) {
        block = await sanitizeLogsBloom(db, chainId!, { ...block, hash });
      } else {
        block = { ...block, hash };
      }
    } else {
      blockPerChain.set(
        chainId!,
        await getBlock(chainId!, hexToNumber(block.number!) + 1),
      );
    }

    return { chainId: chainId!, block };
  };

  const startPwr = promiseWithResolvers<void>();
  const pwr = new Map<number, PromiseWithResolvers<RpcBlock>>();

  for (const [chainId] of chains) {
    pwr.set(chainId, promiseWithResolvers<RpcBlock>());
  }

  return async function* (chainId: number, finalizedBlockNumber: number) {
    blockPerChain.set(
      chainId,
      await getBlock(chainId, finalizedBlockNumber + 1),
    );
    finalizedPerChain.set(chainId, finalizedBlockNumber);

    if (blockPerChain.size === chains.size) {
      startPwr.resolve();
    } else {
      await startPwr.promise;
    }

    while (true) {
      const next = await calculateNextBlock();
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

const sanitizeLogsBloom = async (
  db: NodePgDatabase<typeof PONDER_SYNC_SCHEMA>,
  chainId: number,
  block: RpcBlock,
): Promise<RpcBlock> => {
  const hasLogs = await db
    .select()
    .from(PONDER_SYNC_SCHEMA.logs)
    .where(
      and(
        eq(PONDER_SYNC_SCHEMA.logs.chainId, BigInt(chainId)),
        eq(PONDER_SYNC_SCHEMA.logs.blockHash, block.hash!),
      ),
    )
    .limit(1)
    .then((logs) => logs.length > 0);

  if (hasLogs === false) {
    block.logsBloom = zeroLogsBloom;
  }

  return block;
};

const decodeBlock = (
  block: typeof PONDER_SYNC_SCHEMA.blocks.$inferSelect,
): Omit<RpcBlock, "transactions"> => {
  // @ts-expect-error don't care about extra fields
  return {
    number: toHex(block.number),
    timestamp: toHex(block.timestamp),
    hash: block.hash,
    parentHash: block.parentHash,
    logsBloom: block.logsBloom!,
    miner: checksumAddress(block.miner),
    gasUsed: toHex(block.gasUsed),
    gasLimit: toHex(block.gasLimit),
    baseFeePerGas: block.baseFeePerGas ? toHex(block.baseFeePerGas) : null,
    nonce: block.nonce!,
    mixHash: block.mixHash!,
    stateRoot: block.stateRoot,
    receiptsRoot: block.receiptsRoot,
    transactionsRoot: block.transactionsRoot,
    sha3Uncles: block.sha3Uncles!,
    size: toHex(block.size),
    difficulty: toHex(block.difficulty),
    totalDifficulty: block.totalDifficulty
      ? toHex(block.totalDifficulty)
      : null,
    extraData: block.extraData,
  };
};

const decodeTransaction = (
  transaction: typeof PONDER_SYNC_SCHEMA.transactions.$inferSelect,
): RpcTransaction => {
  return {
    blockNumber: toHex(transaction.blockNumber),
    transactionIndex: toHex(transaction.transactionIndex),
    hash: transaction.hash,
    blockHash: transaction.blockHash,
    from: checksumAddress(transaction.from),
    to: transaction.to ? checksumAddress(transaction.to) : null,
    input: transaction.input,
    value: toHex(transaction.value),
    nonce: toHex(transaction.nonce),
    r: transaction.r!,
    s: transaction.s!,
    v: toHex(transaction.v!),
    type: "0x0",
    gas: toHex(transaction.gas),
    gasPrice: toHex(transaction.gasPrice!),
  };
};

const decodeLog = (
  log: typeof PONDER_SYNC_SCHEMA.logs.$inferSelect,
): RpcLog => {
  return {
    blockNumber: toHex(log.blockNumber),
    logIndex: toHex(log.logIndex),
    transactionIndex: toHex(log.transactionIndex),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    address: checksumAddress(log.address),
    topics: [
      log.topic0!,
      log.topic1 ?? undefined,
      log.topic2 ?? undefined,
      log.topic3 ?? undefined,
    ].filter((topic) => topic !== undefined) as RpcLog["topics"],
    data: log.data,
    removed: false,
  };
};

const decodeTransactionReceipt = (
  receipt: typeof PONDER_SYNC_SCHEMA.transactionReceipts.$inferSelect,
): RpcTransactionReceipt => {
  return {
    blockNumber: toHex(receipt.blockNumber),
    transactionIndex: toHex(receipt.transactionIndex),
    transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash,
    from: checksumAddress(receipt.from),
    to: receipt.to ? checksumAddress(receipt.to) : null,
    contractAddress: receipt.contractAddress
      ? checksumAddress(receipt.contractAddress)
      : null,
    logsBloom: receipt.logsBloom,
    gasUsed: toHex(receipt.gasUsed),
    cumulativeGasUsed: toHex(receipt.cumulativeGasUsed),
    effectiveGasPrice: toHex(receipt.effectiveGasPrice),
    // @ts-ignore
    status: receipt.status === "0x1" ? "success" : "reverted",
    type: receipt.type,
  };
};

const decodeTrace = (
  trace: typeof PONDER_SYNC_SCHEMA.traces.$inferSelect,
): Trace["result"] => {
  return {
    type: trace.type as Trace["result"]["type"],
    from: checksumAddress(trace.from),
    to: trace.to ? checksumAddress(trace.to) : undefined,
    gas: toHex(trace.gas),
    gasUsed: toHex(trace.gasUsed),
    input: trace.input,
    output: trace.output ?? undefined,
    error: trace.error ?? undefined,
    revertReason: trace.revertReason ?? undefined,
    calls: [],
    logs: [],
    value: trace.value ? toHex(trace.value) : undefined,
  };
};
