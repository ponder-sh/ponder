# Ponder internal docs

Informal and incomplete documentation for Ponder's internals

### Backfill ETA calculation

Offering good backfill ETAs are important for building trust. Here's how it works.

The backfill for a specific source uses two queues, one that calls `eth_getLogs` (the log queue) and one for `eth_getBlockByHash` (the block queue). When the backfill first starts, it checks which block ranges are already available in the cache, and then adds tasks to the log queue for any block ranges that are not cached. When a log queue task finishes, it adds a task to the block queue for each unique block containing the returned logs. This could be 0 (no logs returned from `eth_getLogs`), 1 (N logs, all in the same block), 500+ (500 logs, all in different blocks), etc.

There are a few key things to notice. One, the total number of the log tasks does not change during the backfill, it is determined during the "planning" phase before the backfill really starts. But, the total number of block tasks is totally unknown UNTIL the last log task gets processed. With this in mind, here's how to calculate the backfill ETA.

- Every time a new task is added to a queue, update `logTotal` or `blockTotal`. (Remember that all the tasks will get added to the log queue up front, so `logTotal` is effectively constant for these calcs.)
- Every time a task is completed, update `logCurrent` or `blockCurrent`.
- Every 5th task, update `logAvgDuration = (Date.now() - logCheckpointTimestamp) / 5` and then update `logCheckpointTimestamp = Date.now()`. Do the same for `blockAvgDuration`. This gives us a reasonable estimate of the average amount of time it takes to process one task from each queue. Also, for log tasks, update `logAvgBlockCount = (blockCurrent - logCheckpointBlockCount) / 5`

```ts
type BackfillEtaStats = {
  logTotal: number;
  logCurrent: number;
  logCheckpointTimestamp: number;
  logAvgDuration: number;
  logCheckpointBlockCount: number;
  logAvgBlockCount: number;

  blockTotal: number;
  blockCurrent: number;
  blockCheckpointTimestamp: number;
  blockAvgDuration: number;
};

const handleLogTaskCompleted = () => {
  const newLogCurrent = this.backfillStats.logCurrent + 1;

  if (!(newLogCurrent % 5 === 0)) {
    this.backfillStats = {
      ...this.backfillStats,
      logCurrent: newLogCurrent
    };
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const newBlockCount = this.backfillStats.blockTotal;

  this.backfillStats = {
    ...this.backfillStats,
    logCurrent: newLogCurrent,
    logAvgDuration: (now - this.backfillStats.logTaskCheckpointTimestamp) / 5,
    logCheckpointTimestamp: now,
    logAvgBlockCount:
      (newBlockCount - this.backfillStats.logCheckpointBlockCount) / 5,
    logCheckpointBlockCount: newBlockCount
  };
};

const handleBlockTaskCompleted = () => {
  const newBlockCurrent = this.backfillStats.blockCurrent + 1;

  if (!(newBlockCurrent % 5 === 0)) {
    this.backfillStats = {
      ...this.backfillStats,
      blockCurrent: newBlockCurrent
    };
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  this.backfillStats = {
    ...this.backfillStats,
    blockCurrent: newBlockCurrent,
    blockAvgDuration: (now - this.backfillStats.logTaskCheckpointTimestamp) / 5,
    blockCheckpointTimestamp: now
  };
};

const getBackfillEta = ({
  logTotal,
  logCurrent,
  logAvgDuration,
  logAvgBlockCount,
  blockTotal,
  blockCurrent,
  blockAvgDuration
}: BackfillEtaStats) => {
  const logTime = (logTotal - logCurrent) / logAvgDuration;
  const blockTime = (blockTotal - blockCurrent) / blockAvgDuration;

  const estimatedAdditionalBlocks = (logTotal - logCurrent) * logAvgBlockCount;
  const estimatedAdditionalBlockTime =
    estimatedAdditionalBlocks * blockAvgDuration;

  return logTime + blockTime + estimatedAdditionalBlockTime;
};
```
