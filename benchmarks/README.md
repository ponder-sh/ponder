# Benchmarks

This directory contains tooling to benchmark Ponder against the Graph Protocol's [Graph Node](https://github.com/graphprotocol/graph-node).

## Methodology

The benchmarks are run by sequentially running each indexer. Indexers must be run against Anvil in order to effectively notify TheGraph when to stop running. All dbs are cleared before the run. TheGraph indexing cache is busted by programmatically changing the hander function before each run. Ponder doesn't cache indexing function results so no actions are necessary.

## Run Benchmarks

### Ponder

Ponder should be runnable out of the box with [Bun](https://bun.sh) by first starting an Anvil node

```sh
anvil --fork-url $ANVIL_FORK_URL --fork-block-number 17501000
```

and then, in a separate terminal running,

```sh
bun src/ponder.ts
```

Ponder runs against a local build of Ponder, ensure it is built with `pnpm build` at the top level.

### TheGraph

First, the required TypeScript helpers must be generated:

```sh
pnpm graph codegen subgraph/subgraph.yaml
```

Docker is required. TheGraph benchmarks can be run with

```sh
pnpm bench:subgraph
```

It is important to note that the default `graph-node` binary cannot be run on Apple silicon. Instead, `graph-node` must be built from source, following [these instructions](https://github.com/graphprotocol/graph-node/tree/master/docker#running-graph-node-on-an-macbook-m1).

## Results

These results are from indexing Rocket Pool ETH from block range 18,600,000 to 18,718,056 on a M1 MacBook Pro with 8 cores and 16GB of RAM against an Alchemy node with the Growth plan. 950 MB/s wired internet.

Ponder    █████ 31.1s

The Graph ███████████████████████████████████████████████████████ 328s (10.5x)

| Benchmarks | Sync time (w/o cache) | Sync time (w/ cache) | Database size | Alchemy CU |
| ---------- | --------------------- | -------------------- | ------------- | ---------- |
| Ponder     | 31.1s                 | 18.2s                | 31 mB         | 107,668    |
| The Graph  | 328s                  | 75.0s                | 1107 mB       | 166,918    |
