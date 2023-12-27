/**
 * Return the total sum of a list of numeric intervals.
 *
 * @param intervals List of numeric intervals to find the sum of.
 * @returns Sum of the intervals.
 */
export function intervalSum(intervals: [number, number][]) {
  let totalSum = 0;

  for (const [start, end] of intervals) {
    totalSum += end - start + 1;
  }

  return totalSum;
}

/**
 * Return the union of a list of numeric intervals.
 *
 * @param intervals List of numeric intervals to find the union of.
 * @returns Union of the intervals, represented as a list of intervals.
 */
export function intervalUnion(intervals: [number, number][]) {
  if (intervals.length === 0) return [];

  // Sort intervals based on the left end
  intervals.sort((a, b) => a[0] - b[0]);

  const result: [number, number][] = [];
  let currentInterval = intervals[0];

  for (let i = 1; i < intervals.length; i++) {
    const nextInterval = intervals[i];

    if (currentInterval[1] >= nextInterval[0] - 1) {
      // Merge overlapping intervals
      currentInterval[1] = Math.max(currentInterval[1], nextInterval[1]);
    } else {
      // No overlap, add current interval to result
      result.push(currentInterval);
      currentInterval = nextInterval;
    }
  }

  result.push(currentInterval); // Add the last interval
  return result;
}

/**
 * Return the intersection of two lists of numeric intervals.
 *
 * @param list1 First list of numeric intervals.
 * @param list2 Second list of numeric intervals.
 * @returns Intersection of the intervals, represented as a list of intervals.
 */
export function intervalIntersection(
  list1: [number, number][],
  list2: [number, number][],
) {
  const result: [number, number][] = [];
  let i = 0;
  let j = 0;

  while (i < list1.length && j < list2.length) {
    const [start1, end1] = list1[i];
    const [start2, end2] = list2[j];

    const intersectionStart = Math.max(start1, start2);
    const intersectionEnd = Math.min(end1, end2);

    if (intersectionStart <= intersectionEnd) {
      result.push([intersectionStart, intersectionEnd]);
    }

    if (end1 < end2) {
      i++;
    } else {
      j++;
    }
  }

  // Merge potentially overlapping intervals before returning.
  return intervalUnion(result);
}

/**
 * Return the intersection of many lists of numeric intervals.
 *
 * @param list1 First list of numeric intervals.
 * @param list2 Second list of numeric intervals.
 * @returns Difference of the intervals, represented as a list of intervals.
 */
export function intervalIntersectionMany(lists: [number, number][][]) {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0];

  let result: [number, number][] = lists[0];

  for (let i = 1; i < lists.length; i++) {
    result = intervalIntersection(result, lists[i]);
  }

  return intervalUnion(result);
}

/**
 * Return the difference between two lists of numeric intervals (initial - remove).
 *
 * @param initial Starting/base list of numeric intervals.
 * @param remove List of numeric intervals to remove.
 * @returns Difference of the intervals, represented as a list of intervals.
 */
export function intervalDifference(
  initial: [number, number][],
  remove: [number, number][],
) {
  // Create copies to avoid mutating the originals.
  const initial_ = initial.map((interval) => [...interval] as [number, number]);
  const remove_ = remove.map((interval) => [...interval] as [number, number]);

  const result: [number, number][] = [];

  let i = 0;
  let j = 0;

  while (i < initial.length && j < remove.length) {
    const interval1 = initial_[i];
    const interval2 = remove_[j];

    if (interval1[1] < interval2[0]) {
      // No overlap, add interval1 to the result
      result.push(interval1);
      i++;
    } else if (interval2[1] < interval1[0]) {
      // No overlap, move to the next interval in remove
      j++;
    } else {
      // There is an overlap
      if (interval1[0] < interval2[0]) {
        // Add the left part of interval1
        result.push([interval1[0], interval2[0] - 1]);
      }
      if (interval1[1] > interval2[1]) {
        // Update interval1's start to exclude the overlap
        interval1[0] = interval2[1] + 1;
        j++;
      } else {
        // No more overlap, move to the next interval in initial
        i++;
      }
    }
  }

  // Add any remaining intervals from initial
  while (i < initial_.length) {
    result.push(initial_[i]);
    i++;
  }

  return result;
}

export function getChunks({
  intervals,
  maxChunkSize,
}: {
  intervals: [number, number][];
  maxChunkSize: number;
}) {
  const _chunks: [number, number][] = [];

  for (const interval of intervals) {
    const [startBlock, endBlock] = interval;

    let fromBlock = startBlock;
    let toBlock = Math.min(fromBlock + maxChunkSize - 1, endBlock);

    while (fromBlock <= endBlock) {
      _chunks.push([fromBlock, toBlock]);

      fromBlock = toBlock + 1;
      toBlock = Math.min(fromBlock + maxChunkSize - 1, endBlock);
    }
  }

  return _chunks;
}

export class ProgressTracker {
  target: [number, number];
  private _completed: [number, number][];
  private _required: [number, number][] | null = null;
  private _checkpoint: number | null = null;

  /**
   * Constructs a new ProgressTracker object.

   * @throws Will throw an error if the target interval is invalid.
   */
  constructor({
    target,
    completed,
  }: {
    target: [number, number];
    completed: [number, number][];
  }) {
    if (target[0] > target[1])
      throw new Error(
        `Invalid interval: start (${target[0]}) is greater than end (${target[1]})`,
      );

    this.target = target;
    this._completed = completed;
  }

  /**
   * Adds a completed interval.
   *
   * @throws Will throw an error if the new interval is invalid.
   */
  addCompletedInterval(interval: [number, number]) {
    if (interval[0] > interval[1])
      throw new Error(
        `Invalid interval: start (${interval[0]}) is greater than end (${interval[1]})`,
      );

    const prevCheckpoint = this.getCheckpoint();
    this._completed = intervalUnion([...this._completed, interval]);
    this.invalidateCache();
    const newCheckpoint = this.getCheckpoint();

    return {
      isUpdated: newCheckpoint > prevCheckpoint,
      prevCheckpoint,
      newCheckpoint,
    };
  }

  /**
   * Returns the remaining required intervals.
   */
  getRequired() {
    if (this._required === null) {
      this._required = intervalDifference([this.target], this._completed);
    }
    return this._required;
  }

  /**
   * Returns the checkpoint value. If no progress has been made, the checkpoint
   * is equal to the target start minus one.
   */
  getCheckpoint() {
    if (this._checkpoint !== null) return this._checkpoint;

    const completedIntervalIncludingTargetStart = this._completed
      .sort((a, b) => a[0] - b[0])
      .find((i) => i[0] <= this.target[0] && i[1] >= this.target[0]);

    if (completedIntervalIncludingTargetStart) {
      this._checkpoint = completedIntervalIncludingTargetStart[1];
    } else {
      this._checkpoint = this.target[0] - 1;
    }

    return this._checkpoint;
  }

  isComplete = () => {
    if (
      this._completed &&
      this._completed.length === 1 &&
      this._completed[0][0] === this.target[0] &&
      this._completed[0][1] === this.target[1]
    )
      return true;

    return false;
  };

  private invalidateCache() {
    this._required = null;
    this._checkpoint = null;
  }
}

export class BlockProgressTracker {
  private pendingBlocks: number[] = [];
  private completedBlocks: {
    blockNumber: number;
    blockTimestamp: number;
  }[] = [];

  checkpoint: { blockNumber: number; blockTimestamp: number } | null = null;

  addPendingBlocks({ blockNumbers }: { blockNumbers: number[] }): void {
    if (blockNumbers.length === 0) return;

    const maxPendingBlock = this.pendingBlocks[this.pendingBlocks.length - 1];

    const sorted = blockNumbers.sort((a, b) => a - b);
    const minNewPendingBlock = sorted[0];

    if (
      this.pendingBlocks.length > 0 &&
      minNewPendingBlock <= maxPendingBlock
    ) {
      throw new Error(
        `New pending block number ${minNewPendingBlock} was added out of order. Already added block number ${maxPendingBlock}.`,
      );
    }

    sorted.forEach((blockNumber) => {
      this.pendingBlocks.push(blockNumber);
    });
  }

  /**
   * Add a new completed block. If adding this block moves the checkpoint, returns the
   * new checkpoint. Otherwise, returns null.
   */
  addCompletedBlock({
    blockNumber,
    blockTimestamp,
  }: {
    blockNumber: number;
    blockTimestamp: number;
  }) {
    // Find and remove the completed block from the pending list.
    const pendingBlockIndex = this.pendingBlocks.findIndex(
      (pendingBlock) => pendingBlock === blockNumber,
    );
    if (pendingBlockIndex === -1) {
      throw new Error(
        `Block number ${blockNumber} was not pending. Ensure to add blocks as pending before marking them as completed.`,
      );
    }
    this.pendingBlocks.splice(pendingBlockIndex, 1);

    // Add the new completed block to the completed block list, and maintain the sort order.
    // Note that this could be optimized using a for loop with a break.
    this.completedBlocks.push({ blockNumber, blockTimestamp });
    this.completedBlocks.sort((a, b) => a.blockNumber - b.blockNumber);

    // If the pending blocks list is now empty, return the max block present in
    // the list of completed blocks. This happens at the end of the sync.
    if (this.pendingBlocks.length === 0) {
      this.checkpoint = this.completedBlocks[this.completedBlocks.length - 1];
      return this.checkpoint;
    }

    // Find all completed blocks that are less than the minimum pending block.
    // These blocks are "safe".
    const safeCompletedBlocks = this.completedBlocks.filter(
      ({ blockNumber }) => blockNumber < this.pendingBlocks[0],
    );

    // If there are no safe blocks, the first pending block has not been completed yet.
    if (safeCompletedBlocks.length === 0) return null;

    const maximumSafeCompletedBlock =
      safeCompletedBlocks[safeCompletedBlocks.length - 1];

    // Remove all safe completed blocks that are less than the new checkpoint.
    // This avoid a memory leak and speeds up subsequent calls.
    this.completedBlocks = this.completedBlocks.filter(
      ({ blockNumber }) => blockNumber >= maximumSafeCompletedBlock.blockNumber,
    );

    // If this is the first checkpoint OR this checkpoint is greater than
    // the previous checkpoint, store and return it as updated.
    if (
      !this.checkpoint ||
      maximumSafeCompletedBlock.blockNumber > this.checkpoint.blockNumber
    ) {
      this.checkpoint = maximumSafeCompletedBlock;
      return this.checkpoint;
    }

    // Otherwise, the checkpoint is not updated.
    return null;
  }

  isComplete = () => {
    return this.pendingBlocks.length === 0;
  };
}
