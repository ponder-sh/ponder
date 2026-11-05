import { Cause, Effect, Exit } from "effect";
import { RpcHttpError, RpcResponseError } from "@/rpc/transport.js";
import { SimChain } from "./chain.js";
import type { Plan } from "./plan.js";
import { Rng } from "./random.js";
import { makeSimRpc } from "./rpc.js";

type JsonRpcRequest = { id: unknown; method: string; params?: unknown };

/** The URLs of the providers of each chain of `plan`, served at `port`. */
export const getUrls = (plan: Plan, port: number) =>
  Object.fromEntries(
    plan.chains.map((chain) => [
      chain.name,
      chain.rpcs.map((_, i) => `http://localhost:${port}/${chain.name}/${i}`),
    ]),
  );

/** The response of `/stats`. */
export type Stats = {
  /** The latest block of each chain. */
  heads: { [chainName: string]: number };
  /** The number of requests to every provider. */
  requests: number;
};

/**
 * Serve the chains of `plan` over HTTP JSON-RPC, in real time instead of
 * virtual time, for an app that runs outside the simulation.
 *
 * Each chain is moved in time so that its last historical block is now, and
 * mines block `n` at `chain.time(n)` on the wall clock. Each provider of a
 * chain is served at `/<chain name>/<index>`, with the latency, limits, and
 * faults of its plan, and `/stats` returns {@link Stats}. `plan.startTime`,
 * `plan.duration`, and `plan.runs` are not used: the chains mine until
 * `stop`.
 */
export const serveChains = ({ plan, port }: { plan: Plan; port: number }) => {
  const now = Date.now();
  const chains = plan.chains.map((chainPlan) => {
    const lastHistorical =
      chainPlan.genesisTimestamp +
      (chainPlan.historicalBlocks - 1) * chainPlan.blockTime;
    return new SimChain(
      {
        ...chainPlan,
        genesisTimestamp:
          chainPlan.genesisTimestamp + Math.floor(now / 1_000 - lastHistorical),
      },
      plan.seed,
    );
  });
  const providers = new Map(
    chains.map((chain) => [
      chain.plan.name,
      chain.plan.rpcs.map((rpcPlan, j) =>
        makeSimRpc({
          chain,
          plan: rpcPlan,
          index: j,
          rng: new Rng(plan.seed, `rpc:${chain.plan.id}:${j}`),
          startTime: now,
        }),
      ),
    ]),
  );

  // Note: Like the miner of the simulation.
  const minerRngs = chains.map(
    (chain) => new Rng(plan.seed, `miner:${chain.plan.id}`),
  );
  const miner = setInterval(() => {
    const now = Date.now();
    chains.forEach((chain, i) => {
      const rng = minerRngs[i]!;
      while (chain.time(chain.head.number + 1) <= now) {
        if (rng.bool(chain.plan.reorgRate)) {
          chain.reorg(rng.int(1, chain.plan.maxReorgDepth), now);
        }
        chain.mine(now);
      }
    });
  }, 5);

  /** The response to `request`, or the HTTP error that fails it. */
  const respond = async (
    provider: ReturnType<typeof makeSimRpc>,
    { id, method, params }: JsonRpcRequest,
  ): Promise<object | Response> => {
    const exit = await Effect.runPromiseExit(
      provider.transport.request(
        { method, params } as Parameters<typeof provider.transport.request>[0],
        String(id),
      ),
    );
    if (Exit.isSuccess(exit)) return { jsonrpc: "2.0", id, result: exit.value };
    const error = Cause.squash(exit.cause);
    if (error instanceof RpcResponseError) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: error.code, message: error.details },
      };
    }
    if (error instanceof RpcHttpError) {
      return new Response(error.body, { status: error.status });
    }
    // Note: Network errors and timeouts.
    return new Response(null, { status: 502 });
  };

  const stats = (): Stats => ({
    heads: Object.fromEntries(
      chains.map((chain) => [chain.plan.name, chain.head.number]),
    ),
    requests: [...providers.values()]
      .flat()
      .reduce((sum, provider) => sum + provider.stats.requests, 0),
  });

  const server = Bun.serve({
    port,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/stats") return Response.json(stats());

      const [, chainName, index] = pathname.split("/");
      const provider = providers.get(chainName!)?.[Number(index)];
      if (provider === undefined) return new Response(null, { status: 404 });

      const body = (await request.json()) as JsonRpcRequest | JsonRpcRequest[];
      const requests = Array.isArray(body) ? body : [body];
      const responses = await Promise.all(
        requests.map((r) => respond(provider, r)),
      );
      const failure = responses.find((r) => r instanceof Response);
      if (failure) return failure as Response;
      return Response.json(Array.isArray(body) ? responses : responses[0]);
    },
  });

  return {
    chains,
    urls: getUrls(plan, port),
    stats,
    stop: () => {
      clearInterval(miner);
      server.stop(true);
    },
  };
};
