# Historical sync

This README aims to document Ponder's historical sync approach.

## Overview

Please refer to the architecture diagram to see where the historical sync service sits. During startup, the Ponder constructor creates one instance of the historical sync service for each network, passing the event sources (log filter + factories) and user-provided Transport for that network.

The purpose of the historical sync service is to fetch raw blockchain data (blocks, transactions, and logs) from an RPC endpoint and insert that data into the sync store. Most of the complexity comes from the decision to aggressively cache raw blockchain data, which avoids unnecessary RPC requests and enables ~instant sync times when restarting a Ponder app during development.

The historical sync service is responsible for handling blocks up to and including the finalized block for the network. The realtime sync service is responsible for the finalized block through latest.

## API

The historical sync service has a small public API.

- `constructor`: Binds static dependencies like the logger, metrics, etc.
- `setup()` method: Determines what block ranges need to be fetched for each event source, and adds those tasks to the queue.
- `start()` method: Starts processing tasks from the queue.
- `onIdle()` method: Returns a promise that resolves when the historical sync is complete.
- `kill()` method: Kills the service. Must clean up any resources that would block the process from exiting.
- `"historicalCheckpoint"` event: Emitted when the minimum completed block among all registered event sources has progressed. This indicates to consumers that the sync store now contains a complete history of events for all registered event sources between their start block and this block (inclusive).
- `"syncComplete"` event: Emitted when the service has finished processing all historical sync tasks.

## Background

This hare-brained service design won't make sense if you don't first understand a few things about the standard RPC API.

1. Log objects returned from `eth_getLogs` have a block number & hash, but don't contain the full block object. To get the block associated with a log, you must make a follow-up `eth_getBlockByNumber` or `eth_getBlockByHash` request. Some indexers get away without doing these follow-up queries (it's incredibly inefficient!), but we are forced to for two reasons:
   1. We need the `block.timestamp` for every log so we can deterministically sort events across multiple networks into one stream.
   2. The `event` object that we pass to user land contains the full `block` and `transaction` objects associated with a given log.
2. To fetch logs for all child contracts created by a factory, you must first fetch the child contract addresses via `eth_getLogs` requests for the specified factory event, then make another `eth_getLogs` request passing the list of child contract addresses in the `address` parameter. This introduces a dependency: we can't fetch logs for child contracts in block range [1000, 2000] until we've fetched the list of child contracts for block range [0, 2000].

## Requirements

Here are a few rough requirements for the service. These follow from our desired user/developer experience.

1. The historical sync procedure should progress iteratively, starting from the first required block and progressing forward. This unlocks the "dev mode" - users can start writing & getting feedback on indexing function code before the entire sync is complete. Ideally, there will be at least a few events in the sync store in the time it takes a user to move from the terminal where they ran `pnpm dev` to their editor.
2. If a user kills the process and starts it again, the sync progress bar should pick up exactly where it left off.
3. If a user has fully synced an app, then adds a new contract to `ponder.config.ts`, the service should only sync the new contract - the other contracts should be fully cached.
4. The service should handle errors. This includes rate-limiting, `eth_getLogs` block range + response size limits, and random/incidental RPC errors.

## Components

The historical sync service is organized around a few components:

1. A task queue with a high concurrency factor (currently hard-coded to 10)
2. A set of progress trackers (one for each event source)
3. A block callback registry
4. A block progress tracker

The progress trackers are basically an in-memory mirror of the sync store cache metadata. Whenever the block progress tracker checkpoint moves forward, the service emits a `"historicalCheckpoint"` event.

## Task types

There are currently 4 kinds of tasks that can be added to the queue.

### Log filter task

Parameters: `fromBlock`, `toBlock`, `LogFilterCriteria` (this includes `address` and `topics`)

1. Call `eth_getLogs(fromBlock, toBlock, address, topics)` to get all logs matching this filter.
2. For each unique block number among logs.map(log => log.blockNumber), register a block callback. Each block callback inserts raw logs + cache metadata into the sync store.
3. Update the progress tracker for this log filter. Then, if the overall checkpoint across all log filters & child contracts has moved forward, schedule any block tasks that are now ready to be processed.

### Factory contract task

Parameters: `fromBlock`, `toBlock`, `FactoryCriteria` (includes `factoryAddress`, `factoryEventSelector`, `childAddressLocation`)

1. Call `eth_getLogs(fromBlock, toBlock, address: factoryAddress, topics: [factoryEventSelector])` to get all new child contracts in this block range.
2. Add new child contracts to the sync store and update the cache metadata.
3. Update the progress tracker for this factory contract. Then, if the checkpoint for this factory contract has moved forward, schedule new child contract tasks accordingly.

### Child contract task

Parameters: `fromBlock`, `toBlock`, `FactoryCriteria`

1. Query `childContractAddresses` from the sync store up to and including `toBlock`.
2. Call `eth_getLogs(fromBlock, toBlock, address: [childContractAddresses])`.
3. For each unique block number among logs.map(log => log.blockNumber), register a block callback. Each block callback inserts raw logs + cache metadata into the sync store.
4. Update the progress tracker for this child contract. Then, if the overall checkpoint across all log filters & child contracts has moved forward, schedule any block tasks that are now ready to be processed.

### Block task

Parameters: `blockNumber`

1. Call `eth_getBlockByNumber(blockNumber, { includeTransactions: true })`.
2. Run all callbacks that were registered for `blockNumber`.
3. Update the block progress tracker. Then, if the block progress checkpoint has moved forward, emit a `"historicalCheckpoint"` event.

### Trace filter task (TODO!)

Soon, we'll add a 5th kind of task for fetching transaction call events using `trace_filter`. This should be pretty easy to add given the existing progress tracker + block callback design.

## WTF?

Here are some more details to help fill in the blanks:

### Task priority

In a prior version of the service, the queue was FIFO. This was a disaster. The service would first fetch ALL the logs for the entire history of a contract, which took a while. THEN, it would fetch the blocks associated with those logs, and only after that update the cache metadata accordingly (we can't mark a log as cached until we have the associated block + transaction). This sucked because users would run `pnpm dev`, see ~no progress on their sync for a while, then suddenly see a bunch of progress. It also meant that if a user killed the process and started it again, the service would have to start from the beginning.

Now, we use a priority scheme. Tasks are prioritized in the queue by their `fromBlock` or `blockNumber` parameter, ascending. This is how the service satisfies requirement 1 above. A common order of task processing might look like this (all slots processed concurrently):

| time step | slot 0                    | slot 1                       | slot 2                       |
| :-------- | :------------------------ | :--------------------------- | :--------------------------- |
| 0         | log filter task [0, 1000] | log filter task [1001, 2000] | log filter task [2001, 3000] |
| 1         | block task 150            | block task 550               | block task 1700              |
| 2         | block task 2500           | block task 2900              | log filter task [3001, 4000] |

This is great, because as soon as "block task 150" completes, the service emits a `"historicalCheckpoint"` event and the user now has an event to play with. This is how the service satisfies requirement 1 above.

### Callbacks?

Q: Why not handle the `eth_getLogs` request and follow-up `eth_getBlockByNumber` requests in the same task? Wouldn't that be much simpler?

A: It would be much simpler. But, in many cases, the service is processing many event sources that each have logs in the same block. The unified block callback + checkpoint approach means that we will only fetch any given block once, even if it contains logs from multiple event sources. In earlier designs, I observed that the service was making lots of redundant `eth_getBlockByNumber` requests.
