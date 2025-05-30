import {
  type EIP1193Parameters,
  TimeoutError,
  type Transport,
  type TransportConfig,
  createTransport,
} from "viem";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "./utils/promiseWithResolvers.js";

const INITIAL_RETRY_DELAY = 2_000;
const MAX_RETRY_DELAY = 30_000;
const BACKOFF_FACTOR = 2;
const DEFAULT_TIMEOUT = 10_000;
const LATENCY_WINDOW_SIZE = 500;

// RPS management
const INITIAL_MAX_RPS = 50;
const MIN_RPS = 1;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.2;
const RPS_DECREASE_FACTOR = 0.7;
const SUCCESS_WINDOW_SIZE = 100;

const addLatency = (bucket: Bucket, latency: number) => {
  bucket.latencies.push(latency);
  if (bucket.latencies.length > LATENCY_WINDOW_SIZE) {
    bucket.latencies.shift();
  }

  bucket.expectedLatency =
    bucket.latencies.reduce((sum, lat) => sum + lat, 0) /
    bucket.latencies.length;
};

const addRequestMetadata = (bucket: Bucket) => {
  const timestamp = Date.now() / 1000;
  bucket.requestTimestamps.push(timestamp);
  while (timestamp - bucket.requestTimestamps[0]! > 5) {
    bucket.requestTimestamps.shift()!;
  }
};
const getRps = (bucket: Bucket) => {
  const timestamp = Date.now() / 1000;
  while (
    bucket.requestTimestamps.length > 0 &&
    timestamp - bucket.requestTimestamps[0]! > 5
  ) {
    bucket.requestTimestamps.shift()!;
  }

  if (bucket.requestTimestamps.length === 0) return 0;

  const t =
    bucket.requestTimestamps[bucket.requestTimestamps.length - 1]! -
    bucket.requestTimestamps[0]! +
    1;
  return bucket.requestTimestamps.length / t;
};
const isRPSSafe = (bucket: Bucket) => {
  return getRps(bucket) < bucket.maxRPS;
};
const isAvailable = (bucket: Bucket) => {
  return (
    bucket.isActive &&
    // if bucket just activated, let active connections go down and open only one connection for probing
    (!bucket.isJustActivated || bucket.activeConnections === 0) &&
    // if bucket below maxRPS
    isRPSSafe(bucket)
  );
};

const increaseMaxRPS = (bucket: Bucket) => {
  if (bucket.successfulRequests >= SUCCESS_WINDOW_SIZE) {
    const newMaxRPS = Math.min(bucket.maxRPS * RPS_INCREASE_FACTOR, MAX_RPS);
    console.log(
      `Bucket ${bucket.index} increasing max RPS from ${bucket.maxRPS.toFixed(2)} to ${newMaxRPS.toFixed(2)} after ${bucket.successfulRequests} successful requests`,
    );
    bucket.maxRPS = newMaxRPS;
    bucket.successfulRequests = 0;
  }
};
const decreaseMaxRPS = (bucket: Bucket) => {
  const newMaxRPS = Math.max(bucket.maxRPS * RPS_DECREASE_FACTOR, MIN_RPS);
  console.log(
    `Bucket ${bucket.index} decreasing max RPS from ${bucket.maxRPS.toFixed(2)} to ${newMaxRPS.toFixed(2)} due to rate limit`,
  );
  bucket.maxRPS = newMaxRPS;
  bucket.successfulRequests = 0;
};

type Bucket = {
  index: number;
  retryDelay: number;

  activeConnections: number;
  isActive: boolean;
  isJustActivated: boolean;

  latencies: number[];
  expectedLatency: number;

  requestTimestamps: number[];
  successfulRequests: number;
  maxRPS: number;

  totalSuccessfulRequests: number;
  totalFailedRequests: number;
} & ReturnType<Transport>;

export const dynamicLB = (_transports: Transport[]): Transport => {
  return ({ chain, retryCount, timeout }) => {
    const queue: {
      body: EIP1193Parameters;
      pwr: PromiseWithResolvers<unknown>;
    }[] = [];

    const buckets: Bucket[] = _transports.map((transport, index) => ({
      index,
      retryDelay: 0,

      activeConnections: 0,
      isActive: true,
      isJustActivated: false,

      latencies: [] as number[],
      expectedLatency: 0,

      requestTimestamps: [] as number[],
      successfulRequests: 0,
      maxRPS: INITIAL_MAX_RPS,

      totalSuccessfulRequests: 0,
      totalFailedRequests: 0,

      ...transport({
        retryCount: 0,
        timeout: timeout ?? DEFAULT_TIMEOUT,
        chain,
      }),
    }));

    const scheduleBucketActivation = (bucket: Bucket) => {
      setTimeout(() => {
        bucket.isActive = true;
        bucket.isJustActivated = true;
        console.log(
          `Bucket ${bucket.index} reactivated after ${bucket.retryDelay}ms delay`,
        );
      }, bucket.retryDelay);
    };

    const getBucket = async (): Promise<Bucket> => {
      const availableBuckets = buckets.filter((b) => isAvailable(b));

      if (availableBuckets.length === 0) {
        const rpsSafePromise = new Promise<void>((resolve) => {
          const checkRPSSafe = () => {
            const availableBucket = buckets.find((b) => isAvailable(b));
            if (availableBucket) {
              resolve();
            } else {
              setTimeout(checkRPSSafe, 10); // Check every 10ms
            }
          };
          checkRPSSafe();
        });

        await rpsSafePromise;

        return getBucket();
      }

      const fastestBucket = availableBuckets.reduce((fastest, current) => {
        const currentLatency = current.expectedLatency;
        const fastestLatency = fastest.expectedLatency;

        if (currentLatency < fastestLatency) {
          return current;
        }
        return fastest;
      }, availableBuckets[0]!);

      fastestBucket.activeConnections++;
      return fastestBucket;
    };

    const fetch = async (
      body: any,
      tryCount: number,
      bucket_: Bucket | undefined,
    ): Promise<unknown> => {
      const startTime = performance.now();

      const bucket = bucket_ !== undefined ? bucket_ : await getBucket();

      try {
        addRequestMetadata(bucket);
        const response = await bucket.request(body);

        // Record latency
        const latency = performance.now() - startTime;
        addLatency(bucket, latency);

        // Update RPS metadata
        bucket.totalSuccessfulRequests++;
        bucket.successfulRequests++;
        increaseMaxRPS(bucket);

        if (bucket.isJustActivated) {
          bucket.isJustActivated = false;
        }
        if (bucket.isActive && bucket.retryDelay > 0) {
          bucket.retryDelay = 0;
        }

        return response;
      } catch (error) {
        const err = error as any;

        bucket.totalFailedRequests++;

        if (err.code === 429 || err.status === 429) {
          if (bucket.isActive) {
            bucket.isActive = false;
            bucket.isJustActivated = false;

            decreaseMaxRPS(bucket);

            bucket.retryDelay =
              bucket.retryDelay === 0
                ? INITIAL_RETRY_DELAY
                : Math.min(bucket.retryDelay * BACKOFF_FACTOR, MAX_RETRY_DELAY);

            scheduleBucketActivation(bucket);
          }
        } else if (err instanceof TimeoutError) {
          if (bucket.isActive) {
            bucket.isActive = false;
            bucket.isJustActivated = false;

            decreaseMaxRPS(bucket);

            bucket.retryDelay = INITIAL_RETRY_DELAY;

            scheduleBucketActivation(bucket);
          }
        }

        if (tryCount === (retryCount ?? 0)) {
          throw error;
        } else {
          return fetch(body, tryCount + 1, undefined);
        }
      } finally {
        bucket.activeConnections--;
      }
    };

    const dispatch = async () => {
      if (queue.length === 0) return;

      const bucket = await getBucket();

      const {
        body,
        pwr: { reject, resolve },
      } = queue.shift()!;
      await fetch(body, 1, bucket).then(resolve).catch(reject);
    };

    // Purely for debugging
    const printRPCUsage = () => {
      const totalSuccessfulRequests_ = buckets.reduce(
        (acc, cur) => acc + cur.totalSuccessfulRequests,
        0,
      );

      const usage = buckets.map(
        (b) =>
          `RPC ${b.index}: ${b.totalSuccessfulRequests} (${((b.totalSuccessfulRequests * 100) / totalSuccessfulRequests_).toFixed(2)} %); expected latency: ${b.expectedLatency}`,
      );
      console.log(
        "======================= RPC USAGE SUMMARY =======================",
      );
      for (const u of usage) {
        console.log(u);
      }
      console.log(
        "=================================================================",
      );
    };

    setInterval(printRPCUsage, 5000);

    return createTransport({
      key: "dynamicLB",
      name: "dynamic load balance",
      request: async (body) => {
        const pwr = promiseWithResolvers();
        queue.push({ body, pwr });
        dispatch();
        return pwr.promise;
      },
      retryCount: 0,
      timeout: 0,
      type: "dynamicLB",
    } as TransportConfig);
  };
};
