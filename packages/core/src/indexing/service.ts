import type { Common } from "@/Ponder.js";
import type { IndexingFunctions } from "@/build/functions/functions.js";
import type { TableAccess } from "@/build/parseIndexingAst.js";
import type { Network } from "@/config/networks.js";
import {
  type Source,
  sourceIsFactory,
  sourceIsLogFilter,
} from "@/config/sources.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/types.js";
import type { SyncGateway } from "@/sync-gateway/service.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { DatabaseModel } from "@/types/model.js";
import type { Transaction } from "@/types/transaction.js";
import { chains } from "@/utils/chains.js";
import {
  type Checkpoint,
  checkpointMin,
  isCheckpointEqual,
  isCheckpointGreaterThan,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { Emittery } from "@/utils/emittery.js";
import { prettyPrint } from "@/utils/print.js";
import { type Queue, type Worker, createQueue } from "@/utils/queue.js";
import { wait } from "@/utils/wait.js";
import type { AbiEvent } from "abitype";
import { Mutex } from "async-mutex";
import {
  type Abi,
  type Address,
  type Client,
  type Hex,
  decodeEventLog,
} from "viem";
import { checksumAddress, createClient } from "viem";
import { buildDatabaseModels } from "./model.js";
import { type ReadOnlyClient, ponderActions } from "./ponderActions.js";
import { addUserStackTrace } from "./trace.js";
import { ponderTransport } from "./transport.js";

type IndexingEvents = {
  eventsProcessed: { toCheckpoint: Checkpoint };
  error: { error: Error };
};

type SetupTask = {
  kind: "SETUP";
  event: {
    networkName: string;
    contractName: string;
    chainId: number;

    checkpoint: Checkpoint;
  };
};
type LogEventTask = {
  kind: "LOG";
  event: {
    networkName: string;
    contractName: string;
    eventName: string;
    chainId: number;

    event: {
      args: any;
      log: Log;
      block: Block;
      transaction: Transaction;
    };

    checkpoint: Checkpoint;
  };
};

type IndexingFunctionTask = SetupTask | LogEventTask;
type IndexingFunctionQueue = Queue<IndexingFunctionTask>;

export class IndexingService extends Emittery<IndexingEvents> {
  private common: Common;
  private indexingStore: IndexingStore;
  private syncGatewayService: SyncGateway;
  private sources: Source[];

  private indexingFunctions?: IndexingFunctions;
  private schema?: Schema;

  private queue?: IndexingFunctionQueue;

  private db: (checkpoint: Checkpoint) => Record<string, DatabaseModel<any>> =
    undefined!;

  private networkNames: { [sourceId: Source["id"]]: Source["networkName"] } =
    {};

  private contexts: Record<
    number,
    {
      client: Client;
      network: { chainId: number; name: string };
      contracts: Record<
        string,
        {
          abi: Abi;
          address?: Address | readonly Address[];
          startBlock: number;
          endBlock?: number;
          maxBlockRange?: number;
        }
      >;
    }
  > = {};

  private indexingFunctionMap?: Record<
    /* Indexing function key: "{ContractName}:{EventName}" */
    string,
    {
      contractName: string;
      eventName: string;
      /* Checkpoint of most recent completed task. */
      checkpoint: Checkpoint;
      /* Checkpoint of the most recent enqueued task. */
      maxEnqueuedCheckpoint: Checkpoint;
      /* Checkpoint of the most recent task loaded from db. */
      maxTaskCheckpoint: Checkpoint;
      /* Buffer of in memory tasks that haven't been enqueued yet. */
      indexingFunctionTasks: LogEventTask[];
      abiEvent: AbiEvent;
      eventSelector: Hex;
      sources: Source[];
      /* Indexing function keys that write to tables that this indexing function key reads from. */
      parents: string[];
      /* Is this task a parent of itself. */
      selfReliance: boolean;
      dbMutex: Mutex;
    }
  >;

  constructor({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    networks,
    sources,
  }: {
    common: Common;
    syncStore: SyncStore;
    indexingStore: IndexingStore;
    syncGatewayService: SyncGateway;
    networks: Network[];
    sources: Source[];
  }) {
    super();
    this.common = common;
    this.indexingStore = indexingStore;
    this.syncGatewayService = syncGatewayService;
    this.sources = sources;
    this.networkNames = buildNetworkNames(sources);

    this.contexts = buildContexts(
      sources,
      networks,
      syncStore,
      // TODO: fix this 0n problem
      ponderActions(() => 0n),
    );
  }

  kill = async () => {
    // this.isPaused = true;
    this.queue?.pause();
    this.queue?.clear();
    await this.queue?.onIdle();

    this.common.logger.debug({
      service: "indexing",
      msg: "Killed indexing service",
    });
  };

  /**
   * Registers a new set of indexing functions and/or a new schema, cancels
   * the current event processing mutex & event queue, drops and re-creates
   * all tables from the indexing store, and resets eventsProcessedToTimestamp to zero.
   *
   * Note: Caller should (probably) immediately call processEvents after this method.
   */
  reset = async ({
    indexingFunctions: newIndexingFunctions,
    schema: newSchema,
    tableAccess,
  }: {
    indexingFunctions?: IndexingFunctions;
    schema?: Schema;
    tableAccess?: TableAccess;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;
      this.db = buildDatabaseModels({
        common: this.common,
        indexingStore: this.indexingStore,
        schema: this.schema,
      });
    }

    this.common.metrics.ponder_indexing_matched_events.reset();
    this.common.metrics.ponder_indexing_handled_events.reset();
    this.common.metrics.ponder_indexing_processed_events.reset();

    if (newIndexingFunctions && tableAccess) {
      this.indexingFunctions = newIndexingFunctions;

      this.indexingFunctionMap = buildIndexingFunctionMap(
        newIndexingFunctions,
        tableAccess,
        this.sources,
      );

      for (const key of Object.keys(this.indexingFunctionMap)) {
        await this.loadIndexingFunctionTasks(key);
      }

      this.queue = this.createEventQueue();

      this.enqueueSetupTasks(newIndexingFunctions);
    }

    // If either the schema or indexing functions have not been provided yet,
    // we're not ready to process events. Just return early.
    // if (!this.schema || this.indexingFunctionMap === {}) return;

    // Cancel all pending calls to processEvents and reset the mutex.

    // // Pause the old queue, (maybe) wait for the current indexing function to finish,
    // // then create a new queue using the new indexing functions.
    // this.queue?.clear();
    // this.queue?.pause();
    // await this.queue?.onIdle();

    // this.common.logger.debug({
    //   service: "indexing",
    //   msg: "Paused event queue",
    // });

    // this.isPaused = false;
    this.common.metrics.ponder_indexing_has_error.set(0);

    await this.indexingStore.reload({ schema: this.schema });
    this.common.logger.debug({
      service: "indexing",
      msg: "Reset indexing store",
    });

    // // When we call indexingStore.reload() above, the indexing store is dropped.
    // // Set the latest processed timestamp to zero accordingly.
    // this.eventsProcessedToCheckpoint = zeroCheckpoint;
    // this.currentIndexingCheckpoint = zeroCheckpoint;
    this.common.metrics.ponder_indexing_latest_processed_timestamp.set(0);
  };

  private enqueueSetupTasks = (indexingFunctions: IndexingFunctions) => {
    for (const sourceName of Object.keys(indexingFunctions)) {
      for (const eventName of Object.keys(indexingFunctions[sourceName])) {
        if (eventName !== "setup") continue;

        const contexts = Object.values(this.contexts).filter(
          (c) => sourceName in c.contracts,
        );

        for (const { contracts, network } of contexts) {
          const labels = {
            network: network.name,
            contract: sourceName,
            event: "setup",
          };
          this.common.metrics.ponder_indexing_matched_events.inc(labels);

          // The "setup" event uses the contract start block number for contract calls.
          // TODO: Consider implications of this "synthetic" checkpoint on record versioning.
          const checkpoint = {
            ...zeroCheckpoint,
            chainId: network.chainId,
            blockNumber: contracts[sourceName].startBlock,
          };

          this.queue!.addTask({
            kind: "SETUP",
            event: {
              networkName: network.name,
              contractName: sourceName,
              chainId: network.chainId,
              checkpoint,
            },
          });

          this.common.metrics.ponder_indexing_handled_events.inc(labels);
        }
      }
    }
  };

  private enqueueNextTasks = () => {
    if (this.indexingFunctionMap === undefined) return;

    for (const key of Object.keys(this.indexingFunctionMap!)) {
      // return early if no tasks possible to enqueue.
      if (this.indexingFunctionMap[key].indexingFunctionTasks.length === 0)
        continue;

      if (this.indexingFunctionMap[key].parents.length === 0) {
        if (
          this.indexingFunctionMap[key].selfReliance &&
          isCheckpointEqual(
            this.indexingFunctionMap[key].checkpoint,
            this.indexingFunctionMap[key].maxEnqueuedCheckpoint,
          )
        ) {
          // enqueue one task

          const tasksEnqueued = this.indexingFunctionMap[
            key
          ].indexingFunctionTasks.splice(0, 1);

          this.indexingFunctionMap[key].maxEnqueuedCheckpoint =
            tasksEnqueued[0].event.checkpoint;
          this.queue!.addTask(tasksEnqueued[0]!);
        } else if (!this.indexingFunctionMap[key].selfReliance) {
          // enqueue all tasks

          for (const task of this.indexingFunctionMap[key]
            .indexingFunctionTasks) {
            this.queue!.addTask(task);
          }
          this.indexingFunctionMap[key].maxEnqueuedCheckpoint =
            this.indexingFunctionMap[key].indexingFunctionTasks[
              this.indexingFunctionMap[key].indexingFunctionTasks.length - 1
            ].event.checkpoint;
          this.indexingFunctionMap[key].indexingFunctionTasks = [];
        }
        return;
      }

      const parentCheckpoints = this.indexingFunctionMap[key].parents.map(
        (p) => this.indexingFunctionMap![p].checkpoint,
      );

      const minParentCheckpoint = checkpointMin(...parentCheckpoints);

      // maximum checkpoint that is less than `minParentCheckpoint`
      const maxCheckpointIndex = this.indexingFunctionMap[
        key
      ].indexingFunctionTasks.findIndex((task) =>
        isCheckpointGreaterThan(task.event.checkpoint, minParentCheckpoint),
      );
    }
  };

  /**
   * This method is triggered by the realtime sync service detecting a reorg,
   * which can happen at any time. The event queue and the indexing store can be
   * in one of several different states that we need to keep in mind:
   *
   * 1) No events have been added to the queue yet.
   * 2) No unsafe events have been processed (eventsProcessedToTimestamp <= commonAncestorTimestamp).
   * 3) Unsafe events may have been processed (eventsProcessedToTimestamp > commonAncestorTimestamp).
   * 4) The queue has encountered a user error and is waiting for a reload.
   *
   * Note: It's crucial that we acquire a mutex lock while handling the reorg.
   * This will only ever run while the queue is idle, so we can be confident
   * that eventsProcessedToTimestamp matches the current state of the indexing store,
   * and that no unsafe events will get processed after handling the reorg.
   *
   * Note: Caller should (probably) immediately call processEvents after this method.
   */
  handleReorg = async (safeCheckpoint: Checkpoint) => {
    safeCheckpoint;
  };

  /**
   * Processes all newly available events.
   *
   * Acquires a lock on the event processing mutex, then gets the latest checkpoint
   * from the sync gateway service. Fetches events between previous checkpoint
   * and the new checkpoint, adds them to the queue, then processes them.
   */
  processEvents = async () => {
    this.queue!.start();
    this.enqueueNextTasks();

    // this.queue.start();
    // await this.queue.onIdle();
    // // If the queue is already paused here, it means that reset() was called, interrupting
    // // event processing. When this happens, we want to return early.
    // if (this.queue.isPaused) return;
    // this.queue.pause();
    // if (events.length > 0) {
    //   const { blockTimestamp, chainId, blockNumber, logIndex } =
    //     metadata.pageEndCheckpoint;
    //   this.common.logger.info({
    //     service: "indexing",
    //     msg: `Indexed ${
    //       events.length === 1 ? "1 event" : `${events.length} events`
    //     } up to ${formatShortDate(
    //       blockTimestamp,
    //     )} (chainId=${chainId} block=${blockNumber} logIndex=${logIndex})`,
    //   });
    // }
  };

  private executeSetupTask = async (task: SetupTask) => {
    const event = task.event;

    const fullEventName = `${event.contractName}:setup`;
    const indexingFunction = this.indexingFunctions![event.contractName].setup;

    for (let i = 0; i < 4; i++) {
      try {
        this.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${fullEventName}", block=${event.checkpoint.blockNumber})`,
        });

        // Running user code here!
        await indexingFunction({
          context: {
            db: this.db(event.checkpoint),
            ...this.contexts[event.chainId],
          },
        });

        this.indexingFunctionMap![fullEventName].checkpoint = event.checkpoint;

        this.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${fullEventName}", block=${event.checkpoint.blockNumber})`,
        });

        const labels = {
          network: event.networkName,
          contract: event.contractName,
          event: "setup",
        };
        this.common.metrics.ponder_indexing_processed_events.inc(labels);
        this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
          event.checkpoint.blockTimestamp,
        );

        break;
      } catch (error_) {
        const error = error_ as Error & { meta: string };

        if (i === 3) {
          this.queue!.pause();
          this.queue!.clear();
          // this.isPaused = true;

          addUserStackTrace(error, this.common.options);

          this.common.logger.error({
            service: "indexing",
            msg: `Error while processing "setup" event: ${error.message}`,
            error,
          });

          this.common.metrics.ponder_indexing_has_error.set(1);
          this.emit("error", { error });
        } else {
          this.common.logger.warn({
            service: "indexing",
            msg: `Indexing function failed, retrying... (event=${fullEventName}, error=${error.name}: ${error.message})`,
          });
          await this.indexingStore.revert({
            checkpoint: event.checkpoint,
          });
        }
      }
    }
  };

  private executeLogEventTask = async (task: LogEventTask) => {
    const event = task.event;

    const fullEventName = `${event.contractName}:${event.eventName}`;

    const indexingFunction =
      this.indexingFunctions![event.contractName][event.eventName];

    for (let i = 0; i < 4; i++) {
      try {
        this.common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${fullEventName}", block=${event.checkpoint.blockNumber})`,
        });

        // Running user code here!
        await indexingFunction({
          event: {
            name: event.eventName,
            ...event.event,
          },
          context: {
            db: this.db(event.checkpoint),
            ...this.contexts[event.chainId],
          },
        });

        this.indexingFunctionMap![fullEventName].checkpoint = event.checkpoint;

        this.common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${fullEventName}", block=${event.checkpoint.blockNumber})`,
        });

        const labels = {
          network: event.networkName,
          contract: event.contractName,
          event: event.eventName,
        };
        this.common.metrics.ponder_indexing_processed_events.inc(labels);
        this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
          event.checkpoint.blockTimestamp,
        );

        break;
      } catch (error_) {
        const error = error_ as Error & { meta?: string };

        if (i === 3) {
          this.queue!.pause();
          this.queue!.clear();
          // this.isPaused = true;

          addUserStackTrace(error, this.common.options);
          if (error.meta) {
            error.meta += `\nEvent args:\n${prettyPrint(event.event.args)}`;
          } else {
            error.meta = `Event args:\n${prettyPrint(event.event.args)}`;
          }

          this.common.logger.error({
            service: "indexing",
            msg: `Error while processing "${fullEventName}" event at block ${event.checkpoint.blockNumber}:`,
            error,
          });

          this.common.metrics.ponder_indexing_has_error.set(1);
          this.emit("error", { error });
        } else {
          this.common.logger.warn({
            service: "indexing",
            msg: `Indexing function failed, retrying... (event=${fullEventName}, block=${
              event.checkpoint.blockNumber
            }, error=${`${error.name}: ${error.message}`})`,
          });
          await this.indexingStore.revert({
            checkpoint: event.checkpoint,
          });
        }
      }
    }

    await this.indexingFunctionMap![fullEventName].dbMutex.runExclusive(() =>
      this.loadIndexingFunctionTasks(fullEventName),
    ).then(this.enqueueNextTasks);

    // this.enqueueNextTasks();
  };

  private createEventQueue = () => {
    const indexingFunctionWorker: Worker<IndexingFunctionTask> = async ({
      task,
    }) => {
      // This is a hack to ensure that the eventsProcessed method is called and updates
      // the UI when using SQLite. It also allows the process to GC and handle SIGINT events.
      // It does, however, slow down event processing a bit. Too frequent waits cause massive performance loses.
      await wait(0);

      switch (task.kind) {
        case "SETUP": {
          await this.executeSetupTask(task);
          break;
        }
        case "LOG": {
          await this.executeLogEventTask(task);
          break;
        }
      }
    };

    const queue = createQueue({
      worker: indexingFunctionWorker,
      options: {
        concurrency: 10,
        autoStart: false,
      },
    });

    return queue;
  };

  /**
   * Load indexing function tasks from the sync store.
   * Max batch size is 1000.
   */
  private loadIndexingFunctionTasks = async (indexingFunctionKey: string) => {
    if (this.indexingFunctionMap === undefined) return;

    if (
      this.indexingFunctionMap[indexingFunctionKey].indexingFunctionTasks
        .length > 200
    )
      return;

    const maxTaskCheckpoint =
      this.indexingFunctionMap[indexingFunctionKey].maxTaskCheckpoint;

    const { events, metadata } = await this.syncGatewayService.getEvents({
      fromCheckpoint: {
        ...maxTaskCheckpoint,
        logIndex: maxTaskCheckpoint.logIndex
          ? maxTaskCheckpoint.logIndex + 1
          : maxCheckpoint.logIndex,
      },
      toCheckpoint: maxCheckpoint,
      limit: 1_000,
      logFilters: this.indexingFunctionMap[indexingFunctionKey].sources
        .filter(sourceIsLogFilter)
        .map((logFilter) => ({
          id: logFilter.id,
          chainId: logFilter.chainId,
          criteria: logFilter.criteria,
          fromBlock: logFilter.startBlock,
          toBlock: logFilter.endBlock,
          includeEventSelectors: [
            this.indexingFunctionMap![indexingFunctionKey].eventSelector,
          ],
        })),
      factories: this.indexingFunctionMap[indexingFunctionKey].sources
        .filter(sourceIsFactory)
        .map((factory) => ({
          id: factory.id,
          chainId: factory.chainId,
          criteria: factory.criteria,
          fromBlock: factory.startBlock,
          toBlock: factory.endBlock,
          includeEventSelectors: [
            this.indexingFunctionMap![indexingFunctionKey].eventSelector,
          ],
        })),
    });

    this.indexingFunctionMap[indexingFunctionKey].maxTaskCheckpoint =
      metadata.endCheckpoint;

    const keyMetadata = metadata.counts.find(
      ({ selector }) =>
        selector ===
        this.indexingFunctionMap![indexingFunctionKey].eventSelector,
    )!;

    if (keyMetadata !== undefined) {
      const labels = {
        network: this.networkNames[keyMetadata.sourceId],
        contract: this.indexingFunctionMap![indexingFunctionKey].contractName,
        event: this.indexingFunctionMap![indexingFunctionKey].eventName,
      };

      const count = keyMetadata.count > 1_000 ? 1_000 : keyMetadata.count;
      this.common.metrics.ponder_indexing_matched_events.inc(labels, count);
      this.common.metrics.ponder_indexing_handled_events.inc(labels, count);
    }

    for (const event of events) {
      try {
        const decodedLog = decodeEventLog({
          abi: [this.indexingFunctionMap[indexingFunctionKey].abiEvent],
          data: event.log.data,
          topics: event.log.topics,
        });

        this.indexingFunctionMap[
          indexingFunctionKey
        ].indexingFunctionTasks.push({
          kind: "LOG",
          event: {
            networkName: this.networkNames[event.sourceId],
            contractName:
              this.indexingFunctionMap[indexingFunctionKey].contractName,
            eventName: this.indexingFunctionMap[indexingFunctionKey].eventName,
            chainId: event.chainId,
            event: {
              args: decodedLog.args ?? {},
              log: event.log,
              block: event.block,
              transaction: event.transaction,
            },
            checkpoint: {
              blockNumber: Number(event.block.number),
              blockTimestamp: Number(event.block.timestamp),
              chainId: event.chainId,
              logIndex: event.log.logIndex,
            },
          },
        });
      } catch (err) {
        // Sometimes, logs match a selector but cannot be decoded using the provided ABI.
        // This happens often when using custom event filters, because the indexed-ness
        // of an event parameter is not taken into account when generating the selector.
        this.common.logger.debug({
          service: "app",
          msg: `Unable to decode log, skipping it. id: ${event.log.id}, data: ${event.log.data}, topics: ${event.log.topics}`,
        });
      }
    }
  };
}

const buildNetworkNames = (sources: Source[]) => {
  const networkNames = {} as IndexingService["networkNames"];

  for (const source of sources) {
    networkNames[source.id] = source.networkName;
  }

  return networkNames;
};

const buildIndexingFunctionMap = (
  indexingFunctions: IndexingFunctions,
  tableAccess: TableAccess,
  sources: Source[],
) => {
  const indexingFunctionMap = {} as NonNullable<
    IndexingService["indexingFunctionMap"]
  >;

  for (const contractName of Object.keys(indexingFunctions)) {
    for (const eventName of Object.keys(indexingFunctions[contractName])) {
      if (eventName === "setup") continue;

      const indexingFunctionKey = `${contractName}:${eventName}`;

      // All tables that this indexing function key reads
      const tableReads = tableAccess
        .filter(
          (t) =>
            t.indexingFunctionKey === indexingFunctionKey &&
            t.access === "read",
        )
        .map((t) => t.table);

      // all indexing function keys that write to a table in `tableReads`
      // except for itself.
      const parents = tableAccess
        .filter(
          (t) =>
            t.access === "write" &&
            tableReads.includes(t.table) &&
            t.indexingFunctionKey !== indexingFunctionKey,
        )
        .map((t) => t.indexingFunctionKey);

      const selfReliance = tableAccess.some(
        (t) =>
          t.access === "write" &&
          tableReads.includes(t.table) &&
          t.indexingFunctionKey === indexingFunctionKey,
      );

      const keySources = sources.filter((s) => s.contractName === contractName);

      const i = sources.findIndex(
        (s) =>
          s.contractName === contractName &&
          s.abiEvents.bySafeName[eventName] !== undefined,
      );

      const abiEvent = sources[i].abiEvents.bySafeName[eventName]!.item;
      const eventSelector =
        sources[i].abiEvents.bySafeName[eventName]!.selector;

      indexingFunctionMap[indexingFunctionKey] = {
        eventName,
        contractName,

        checkpoint: zeroCheckpoint,
        maxEnqueuedCheckpoint: zeroCheckpoint,
        maxTaskCheckpoint: zeroCheckpoint,

        sources: keySources,
        indexingFunctionTasks: [],

        abiEvent: abiEvent!,
        eventSelector,

        parents: dedupe(parents),
        selfReliance,
        dbMutex: new Mutex(),
      };
    }
  }

  return indexingFunctionMap;
};

const buildContexts = (
  sources: Source[],
  networks: Network[],
  syncStore: SyncStore,
  actions: ReturnType<typeof ponderActions>,
) => {
  const contexts: Record<
    number,
    {
      client: Client;
      network: { chainId: number; name: string };
      contracts: Record<
        string,
        {
          abi: Abi;
          address?: Address | readonly Address[];
          startBlock: number;
          endBlock?: number;
          maxBlockRange?: number;
        }
      >;
    }
  > = {};

  networks.forEach((network) => {
    const defaultChain =
      Object.values(chains).find((c) => c.id === network.chainId) ??
      chains.mainnet;

    const client = createClient({
      transport: ponderTransport({ network, syncStore }),
      chain: { ...defaultChain, name: network.name, id: network.chainId },
    });

    contexts[network.chainId] = {
      network: { name: network.name, chainId: network.chainId },
      // Changing the arguments of readContract is not usually allowed,
      // because we have such a limited api we should be good
      client: client.extend(actions as any) as ReadOnlyClient,
      contracts: {},
    };
  });

  sources.forEach((source) => {
    // Only include the address if it's singular and  static.
    const address =
      typeof source.criteria.address === "string"
        ? source.criteria.address
        : undefined;

    contexts[source.chainId] = {
      ...contexts[source.chainId],
      contracts: {
        ...contexts[source.chainId].contracts,
        [source.contractName]: {
          abi: source.abi,
          address: address ? checksumAddress(address) : address,
          startBlock: source.startBlock,
          endBlock: source.endBlock,
          maxBlockRange: source.maxBlockRange,
        },
      },
    };
  });

  return contexts;
};
