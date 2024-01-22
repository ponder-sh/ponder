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
import type { Transaction } from "@/types/transaction.js";
import {
  type Checkpoint,
  checkpointMax,
  checkpointMin,
  isCheckpointEqual,
  isCheckpointGreaterThan,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatShortDate } from "@/utils/date.js";
import { dedupe } from "@/utils/dedupe.js";
import { Emittery } from "@/utils/emittery.js";
import { prettyPrint } from "@/utils/print.js";
import { type Queue, type Worker, createQueue } from "@/utils/queue.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { wait } from "@/utils/wait.js";
import type { AbiEvent } from "abitype";
import { E_CANCELED, Mutex, type MutexInterface } from "async-mutex";
import { type Hex, decodeEventLog } from "viem";
import {
  type Context,
  buildClient,
  buildContracts,
  buildDB,
  buildNetwork,
} from "./context.js";
import { addUserStackTrace } from "./trace.js";

type IndexingEvents = {
  eventsProcessed: { toCheckpoint: Checkpoint };
  error: { error: Error };
};

type SetupTask = {
  kind: "SETUP";
  event: {
    networkName: string;
    contractName: string;
    checkpoint: Checkpoint;
  };
};
type LogEventTask = {
  kind: "LOG";
  event: {
    networkName: string;
    contractName: string;
    eventName: string;
    event: {
      args: any;
      log: Log;
      block: Block;
      transaction: Transaction;
    };
    checkpoint: Checkpoint;
    endCheckpoint?: Checkpoint;
    eventsProcessed?: number;
  };
};

type IndexingFunctionTask = SetupTask | LogEventTask;
type IndexingFunctionQueue = Queue<IndexingFunctionTask>;

// Note: this should move to a dynamic value, based on how many indexing function keys there are.
const TASK_BATCH_SIZE = 1_000;

export class IndexingService extends Emittery<IndexingEvents> {
  private common: Common;
  private indexingStore: IndexingStore;
  private syncGatewayService: SyncGateway;
  private sources: Source[];
  private networks: Network[];

  private isPaused = false;

  private indexingFunctions?: IndexingFunctions;
  private schema?: Schema;
  private tableAccess?: TableAccess;

  private queue?: IndexingFunctionQueue;

  private getNetwork: (checkpoint: Checkpoint) => Context["network"] =
    undefined!;
  private getClient: (checkpoint: Checkpoint) => Context["client"] = undefined!;
  private getDB: (checkpoint: Checkpoint) => Context["db"] = undefined!;
  private getContracts: (checkpoint: Checkpoint) => Context["contracts"] =
    undefined!;

  private indexingFunctionMap: Record<
    /* Indexing function key: "{ContractName}:{EventName}" */
    string,
    {
      contractName: string;
      eventName: string;
      /* Indexing function keys that write to tables that this indexing function key reads from. */
      parents: string[];
      /* True if this key is a parent of itself. */
      selfReliance: boolean;
      /* Sources that contribute to this indexing function. */
      sources: Source[];
      abiEvent: AbiEvent;
      eventSelector: Hex;

      /* Checkpoint of max completed task. */
      checkpoint: Checkpoint;
      /* Checkpoint of the most recent task loaded from db. */
      maxTaskCheckpoint: Checkpoint;
      /* Buffer of in memory tasks that haven't been enqueued yet. */
      indexingFunctionTasks: LogEventTask[];
      /* Mutex ensuring tasks are loaded one at a time. */
      dbMutex: Mutex;
      /** True if a task has been enqueued with itself as the most. */
      serialQueue: boolean;
    }
  > = {};

  private networkNames: { [sourceId: Source["id"]]: Source["networkName"] } =
    {};

  constructor({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    networks,
    requestQueues,
    sources,
  }: {
    common: Common;
    syncStore: SyncStore;
    indexingStore: IndexingStore;
    syncGatewayService: SyncGateway;
    networks: Network[];
    requestQueues: RequestQueue[];
    sources: Source[];
  }) {
    super();
    this.common = common;
    this.indexingStore = indexingStore;
    this.syncGatewayService = syncGatewayService;
    this.sources = sources;
    this.networks = networks;

    this.buildNetworkNames();

    this.getNetwork = buildNetwork({
      networks,
    });
    this.getClient = buildClient({
      networks,
      requestQueues,
      syncStore,
    });
    this.getContracts = buildContracts({
      sources,
    });
  }

  kill = () => {
    this.isPaused = true;

    this.queue?.pause();
    this.queue?.clear();
    for (const key of Object.keys(this.indexingFunctionMap!)) {
      this.indexingFunctionMap![key].dbMutex.cancel();
    }
    this.common.logger.debug({
      service: "indexing",
      msg: "Killed indexing service",
    });
  };

  onIdle = () => this.queue!.onIdle();

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
    tableAccess: newTableAccess,
  }: {
    indexingFunctions?: IndexingFunctions;
    schema?: Schema;
    tableAccess?: TableAccess;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;

      this.getDB = buildDB({
        common: this.common,
        indexingStore: this.indexingStore,
        schema: this.schema,
      });
    }

    if (newIndexingFunctions) {
      this.indexingFunctions = newIndexingFunctions;
    }

    if (newTableAccess) {
      this.tableAccess = newTableAccess;
    }

    if (
      this.indexingFunctions === undefined ||
      this.sources === undefined ||
      this.tableAccess === undefined
    )
      return;

    if (Object.keys(this.indexingFunctionMap).length !== 0) {
      await Promise.all(
        Object.values(this.indexingFunctionMap).map((keyHandler) =>
          keyHandler.dbMutex.cancel(),
        ),
      );
    }

    this.queue?.clear();
    this.queue?.pause();
    await this.queue?.onIdle();

    this.buildIndexingFunctionMap();
    this.createEventQueue();

    this.common.logger.debug({
      service: "indexing",
      msg: "Paused event queue",
    });

    this.isPaused = false;
    this.common.metrics.ponder_indexing_has_error.set(0);

    this.common.metrics.ponder_indexing_matched_events.reset();
    this.common.metrics.ponder_indexing_handled_events.reset();
    this.common.metrics.ponder_indexing_processed_events.reset();

    await this.indexingStore.reload({ schema: this.schema });
    this.common.logger.debug({
      service: "indexing",
      msg: "Reset indexing store",
    });

    this.common.metrics.ponder_indexing_latest_processed_timestamp.set(0);
  };

  /**
   * Processes all newly available events.
   *
   * Acquires a lock on the event processing mutex, then gets the latest checkpoint
   * from the sync gateway service. Fetches events between previous checkpoint
   * and the new checkpoint, adds them to the queue, then processes them.
   */
  processEvents = async () => {
    if (
      Object.keys(this.indexingFunctionMap).length === 0 ||
      this.queue === undefined ||
      this.isPaused
    )
      return;

    this.enqueueSetupTasks();

    // Note: We must ensure that the setup tasks have finished before enqueing the log event tasks
    this.queue!.start();
    await this.queue.onIdle();

    await Promise.all(
      Object.entries(this.indexingFunctionMap).map(([key, keyHandler]) =>
        keyHandler.dbMutex.runExclusive(() =>
          this.loadIndexingFunctionTasks(key),
        ),
      ),
    );

    this.enqueueLogEventTasks();

    await this.queue.onIdle();
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
    if (this.isPaused) return;

    let release: MutexInterface.Releaser[];
    try {
      release = await Promise.all(
        Object.values(this.indexingFunctionMap!).map((indexFunc) =>
          indexFunc.dbMutex.acquire(),
        ),
      );
      const hasProcessedInvalidEvents = Object.values(
        this.indexingFunctionMap!,
      ).some((indexFunc) =>
        isCheckpointGreaterThan(indexFunc.checkpoint, safeCheckpoint),
      );

      if (!hasProcessedInvalidEvents) {
        // No unsafe events have been processed, so no need to revert (case 1 & case 2).
        this.common.logger.debug({
          service: "indexing",
          msg: "No unsafe events were detected while reconciling a reorg, no-op",
        });
        return;
      }

      // Unsafe events have been processed, must revert the indexing store and update
      // eventsProcessedToTimestamp accordingly (case 3).
      await this.indexingStore.revert({ checkpoint: safeCheckpoint });

      this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
        safeCheckpoint.blockTimestamp,
      );

      // Note: There's currently no way to know how many events are "thrown out"
      // during the reorg reconciliation, so the event count metrics
      // (e.g. ponder_indexing_processed_events) will be slightly inflated.

      this.common.logger.debug({
        service: "indexing",
        msg: `Reverted indexing store to safe timestamp ${safeCheckpoint.blockTimestamp}`,
      });

      for (const indexFunc of Object.values(this.indexingFunctionMap!)) {
        if (isCheckpointGreaterThan(indexFunc.checkpoint, safeCheckpoint)) {
          indexFunc.checkpoint = safeCheckpoint;
        }
        if (
          isCheckpointGreaterThan(indexFunc.maxTaskCheckpoint, safeCheckpoint)
        ) {
          indexFunc.maxTaskCheckpoint = safeCheckpoint;
        }
      }
    } catch (error) {
      // Pending locks get cancelled in reset(). This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    } finally {
      for (const r of release!) {
        r();
      }
    }
  };

  private enqueueSetupTasks = () => {
    for (const contractName of Object.keys(this.indexingFunctions!)) {
      if (this.indexingFunctions![contractName].setup === undefined) return;

      for (const network of this.networks) {
        const source = this.sources.find(
          (s) =>
            s.contractName === contractName && s.chainId === network.chainId,
        )!;

        const labels = {
          network: network.name,
          contract: contractName,
          event: "setup",
        };
        this.common.metrics.ponder_indexing_matched_events.inc(labels);

        // The "setup" event uses the contract start block number for contract calls.
        // TODO: Consider implications of this "synthetic" checkpoint on record versioning.
        const checkpoint = {
          ...zeroCheckpoint,
          chainId: network.chainId,
          blockNumber: source.startBlock,
        };

        this.queue!.addTask({
          kind: "SETUP",
          event: {
            networkName: network.name,
            contractName,
            checkpoint,
          },
        });

        this.common.metrics.ponder_indexing_handled_events.inc(labels);
      }
    }
  };

  /**
   * Implements core concurrency engine.
   */
  private enqueueLogEventTasks = () => {
    if (this.indexingFunctionMap === undefined) return;

    for (const key of Object.keys(this.indexingFunctionMap!)) {
      const keyHandler = this.indexingFunctionMap[key];
      const tasks = keyHandler.indexingFunctionTasks;

      if (tasks.length === 0) continue;

      if (
        keyHandler.parents.length === 0 &&
        keyHandler.selfReliance &&
        !keyHandler.serialQueue
      ) {
        // Hot loop for an indexing function only relying on itself.
        // Should enqueue one task.
        const tasksEnqueued = tasks.splice(0, 1);

        this.queue!.addTask(tasksEnqueued[0]!);

        keyHandler.serialQueue = true;
      } else if (keyHandler.parents.length === 0 && !keyHandler.selfReliance) {
        // Hot loop for an indexing function that does rely on anything.
        // Should enqueue all tasks in buffer.
        for (const task of tasks) {
          this.queue!.addTask(task);
        }
        keyHandler.indexingFunctionTasks = [];
      } else if (keyHandler.parents.length !== 0) {
        const parentCheckpoints = keyHandler.parents.map(
          (p) => this.indexingFunctionMap![p].checkpoint,
        );

        // blahahaha
        if (keyHandler.selfReliance && !keyHandler.serialQueue)
          parentCheckpoints.push(keyHandler.checkpoint);

        const minParentCheckpoint = checkpointMin(...parentCheckpoints);

        // maximum checkpoint that is less than `minParentCheckpoint`
        const maxCheckpointIndex = tasks.findIndex((task) =>
          isCheckpointGreaterThan(task.event.checkpoint, minParentCheckpoint),
        );

        if (maxCheckpointIndex === -1) {
          for (const task of tasks) {
            this.queue!.addTask(task);
          }

          keyHandler.indexingFunctionTasks = [];
        } else {
          const tasksEnqueued = tasks.splice(0, maxCheckpointIndex);

          for (const task of tasksEnqueued) {
            this.queue!.addTask(task);
          }
        }

        if (
          maxCheckpointIndex !== 0 &&
          keyHandler.selfReliance &&
          keyHandler.serialQueue &&
          isCheckpointEqual(keyHandler.checkpoint, minParentCheckpoint)
        ) {
          keyHandler.serialQueue = true;
        }
      }
    }
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
            network: this.getNetwork(task.event.checkpoint),
            client: this.getClient(task.event.checkpoint),
            db: this.getDB(task.event.checkpoint),
            contracts: this.getContracts(task.event.checkpoint),
          },
        });

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
          this.isPaused = true;
          this.queue!.pause();
          this.queue!.clear();

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
            network: this.getNetwork(event.checkpoint),
            client: this.getClient(event.checkpoint),
            db: this.getDB(event.checkpoint),
            contracts: this.getContracts(event.checkpoint),
          },
        });

        if (event.endCheckpoint !== undefined) {
          this.indexingFunctionMap![fullEventName].checkpoint = checkpointMax(
            this.indexingFunctionMap![fullEventName].checkpoint,
            event.endCheckpoint,
          );
          this.emitCheckpoint();
        } else {
          this.indexingFunctionMap![fullEventName].checkpoint = checkpointMax(
            this.indexingFunctionMap![fullEventName].checkpoint,
            event.checkpoint,
          );
        }

        if (event.eventsProcessed) {
          const num = event.eventsProcessed;
          this.common.logger.info({
            service: "indexing",
            msg: `Indexed ${
              num === 1 ? "1 event" : `${num} events`
            } up to ${formatShortDate(
              event.checkpoint.blockTimestamp,
            )} (event=${fullEventName} chainId=${
              event.checkpoint.chainId
            } block=${event.checkpoint.blockNumber} logIndex=${
              event.checkpoint.logIndex
            })`,
          });
        }

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
          this.isPaused = true;
          this.queue!.pause();
          this.queue!.clear();

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

    this.indexingFunctionMap![fullEventName].serialQueue = false;

    await this.indexingFunctionMap![fullEventName].dbMutex.runExclusive(() =>
      this.loadIndexingFunctionTasks(fullEventName),
    ).then(() => {
      if (this.queue?.isPaused === false) this.enqueueLogEventTasks();
    });
  };

  private createEventQueue = () => {
    const indexingFunctionWorker: Worker<IndexingFunctionTask> = async ({
      task,
    }) => {
      // This is a hack to ensure that the eventsProcessed method is called and updates
      // the UI when using SQLite. It also allows the process to GC and handle SIGINT events.
      // It does, however, slow down event processing a bit. Too frequent waits cause massive performance loses.
      if (Math.floor(Math.random() * 100) === 69) await wait(0);

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

    this.queue = createQueue({
      worker: indexingFunctionWorker,
      options: {
        concurrency: 10,
        autoStart: false,
      },
    });
  };

  /**
   * Load a batch of indexing function tasks from the sync store into memory.
   */
  private loadIndexingFunctionTasks = async (key: string) => {
    const keyHandler = this.indexingFunctionMap![key];
    const tasks = keyHandler.indexingFunctionTasks;

    if (
      tasks.length > 0 ||
      isCheckpointEqual(
        keyHandler.maxTaskCheckpoint,
        this.syncGatewayService.checkpoint,
      )
    )
      return;

    const { events, metadata } = await this.syncGatewayService.getEvents({
      fromCheckpoint: keyHandler.maxTaskCheckpoint,
      toCheckpoint: this.syncGatewayService.checkpoint,
      limit: TASK_BATCH_SIZE,
      logFilters: keyHandler.sources
        .filter(sourceIsLogFilter)
        .map((logFilter) => ({
          id: logFilter.id,
          chainId: logFilter.chainId,
          criteria: logFilter.criteria,
          fromBlock: logFilter.startBlock,
          toBlock: logFilter.endBlock,
          includeEventSelectors: [keyHandler.eventSelector],
        })),
      factories: keyHandler.sources.filter(sourceIsFactory).map((factory) => ({
        id: factory.id,
        chainId: factory.chainId,
        criteria: factory.criteria,
        fromBlock: factory.startBlock,
        toBlock: factory.endBlock,
        includeEventSelectors: [keyHandler.eventSelector],
      })),
    });

    if (events.length < TASK_BATCH_SIZE) {
      keyHandler.maxTaskCheckpoint = this.syncGatewayService.checkpoint;
    } else {
      keyHandler.maxTaskCheckpoint = metadata.endCheckpoint;
    }

    const keyMetadata = metadata.counts.find(
      ({ selector }) => selector === keyHandler.eventSelector,
    );

    // keyMetadata can be undefined if no events are found in between the checkpoints
    if (keyMetadata !== undefined) {
      const labels = {
        network: this.networkNames[keyMetadata.sourceId],
        contract: keyHandler.contractName,
        event: keyHandler.eventName,
      };

      const count =
        keyMetadata.count >= TASK_BATCH_SIZE
          ? TASK_BATCH_SIZE
          : keyMetadata.count;
      this.common.metrics.ponder_indexing_matched_events.inc(labels, count);
      this.common.metrics.ponder_indexing_handled_events.inc(labels, count);
    }

    const abi = [keyHandler.abiEvent];
    const contractName = keyHandler.contractName;
    const eventName = keyHandler.eventName;

    for (const event of events) {
      try {
        const decodedLog = decodeEventLog({
          abi,
          data: event.log.data,
          topics: event.log.topics,
        });

        tasks.push({
          kind: "LOG",
          event: {
            networkName: this.networkNames[event.sourceId],
            contractName,
            eventName,
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

    // handle last event
    if (tasks.length !== 0) {
      tasks[tasks.length - 1].event.endCheckpoint =
        keyHandler.maxTaskCheckpoint;

      tasks[tasks.length - 1].event.eventsProcessed = events.length;
    } else {
      keyHandler.checkpoint = keyHandler.maxTaskCheckpoint;
      this.emitCheckpoint();
    }
  };

  private emitCheckpoint = () => {
    const checkpoint = checkpointMin(
      ...Object.values(this.indexingFunctionMap!).map((i) => i.checkpoint),
    );

    this.emit("eventsProcessed", {
      toCheckpoint: checkpoint,
    });
  };

  private buildNetworkNames = () => {
    for (const source of this.sources) {
      this.networkNames[source.id] = source.networkName;
    }
  };

  private buildIndexingFunctionMap = () => {
    if (
      this.indexingFunctions === undefined ||
      this.sources === undefined ||
      this.tableAccess === undefined
    )
      return;

    // clear in case of reloads
    this.indexingFunctionMap = {};

    for (const contractName of Object.keys(this.indexingFunctions)) {
      // Note: It's suspicious that this is neccessary.
      const events = Object.keys(
        this.indexingFunctions[contractName],
      ) as string[];
      for (const eventName of events) {
        if (eventName === "setup") continue;

        const indexingFunctionKey = `${contractName}:${eventName}`;

        // All tables that this indexing function key reads
        const tableReads = this.tableAccess
          .filter(
            (t) =>
              t.indexingFunctionKey === indexingFunctionKey &&
              t.access === "read",
          )
          .map((t) => t.table);

        // All indexing function keys that write to a table in `tableReads`
        // except for itself.
        const parents = this.tableAccess
          .filter(
            (t) =>
              t.access === "write" &&
              tableReads.includes(t.table) &&
              t.indexingFunctionKey !== indexingFunctionKey,
          )
          .map((t) => t.indexingFunctionKey);

        const selfReliance = this.tableAccess.some(
          (t) =>
            t.access === "write" &&
            tableReads.includes(t.table) &&
            t.indexingFunctionKey === indexingFunctionKey,
        );

        const keySources = this.sources.filter(
          (s) => s.contractName === contractName,
        );

        // Note: Assumption is that all sources with the same contract name have the same abi.
        const i = this.sources.findIndex(
          (s) =>
            s.contractName === contractName &&
            s.abiEvents.bySafeName[eventName] !== undefined,
        );

        const abiEvent = this.sources[i].abiEvents.bySafeName[eventName]!.item;
        const eventSelector =
          this.sources[i].abiEvents.bySafeName[eventName]!.selector;

        this.indexingFunctionMap[indexingFunctionKey] = {
          eventName,
          contractName,
          parents: dedupe(parents),
          selfReliance,
          sources: keySources,
          abiEvent,
          eventSelector,

          checkpoint: zeroCheckpoint,
          maxTaskCheckpoint: zeroCheckpoint,
          indexingFunctionTasks: [],
          dbMutex: new Mutex(),
          serialQueue: false,
        };
      }
    }
  };
}
