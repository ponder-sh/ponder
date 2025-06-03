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
/** Hurdle rate for switching to a faster bucket. */
const LATENCY_HURDLE_RATE = 0.1;
/** Exploration rate. */
const EPSILON = 0.1;

// RPS management
const INITIAL_MAX_RPS = 50;
const MIN_RPS = 1;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.2;
const RPS_DECREASE_FACTOR = 0.7;
const RPS_INCREASE_QUALIFIER = 0.8;
const SUCCESS_WINDOW_SIZE = 100;

type Bucket = {
  index: number;
  retryDelay: number;

  activeConnections: number;
  isActive: boolean;
  isJustActivated: boolean;

  latencyMetadata: {
    latencies: { value: number; success: boolean }[];

    successfulLatencies: number;
    latencySum: number;
  };
  expectedLatency: number;

  requestTimestamps: number[];
  consecutiveSuccessfulRequests: number;
  rpsLimit: number;

  totalSuccessfulRequests: number;
  totalFailedRequests: number;
} & ReturnType<Transport>;

const addLatency = (bucket: Bucket, latency: number, success: boolean) => {
  bucket.latencyMetadata.latencies.push({ value: latency, success });
  bucket.latencyMetadata.latencySum += latency;
  if (success) {
    bucket.latencyMetadata.successfulLatencies++;
  }

  if (bucket.latencyMetadata.latencies.length > LATENCY_WINDOW_SIZE) {
    const record = bucket.latencyMetadata.latencies.shift()!;
    bucket.latencyMetadata.latencySum -= record.value;
    if (record.success) {
      bucket.latencyMetadata.successfulLatencies--;
    }
  }

  bucket.expectedLatency =
    bucket.latencyMetadata.latencySum /
    bucket.latencyMetadata.successfulLatencies;
};

const addRequestTimestamp = (bucket: Bucket) => {
  const timestamp = Date.now() / 1000;
  bucket.requestTimestamps.push(timestamp);
  while (timestamp - bucket.requestTimestamps[0]! > 5) {
    bucket.requestTimestamps.shift()!;
  }
};

const getRPS = (bucket: Bucket) => {
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
  return getRPS(bucket) < bucket.rpsLimit;
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
  if (
    bucket.consecutiveSuccessfulRequests >= SUCCESS_WINDOW_SIZE &&
    getRPS(bucket) > bucket.rpsLimit * RPS_INCREASE_QUALIFIER
  ) {
    const newRPSLimit = Math.min(
      bucket.rpsLimit * RPS_INCREASE_FACTOR,
      MAX_RPS,
    );
    console.log(
      `Bucket ${bucket.index} increasing max RPS from ${bucket.rpsLimit.toFixed(2)} to ${newRPSLimit.toFixed(2)} after ${bucket.consecutiveSuccessfulRequests} consecutive successful requests`,
    );
    bucket.rpsLimit = newRPSLimit;
    bucket.consecutiveSuccessfulRequests = 0;
  }
};

const decreaseMaxRPS = (bucket: Bucket) => {
  const newRPSLimit = Math.max(bucket.rpsLimit * RPS_DECREASE_FACTOR, MIN_RPS);
  console.log(
    `Bucket ${bucket.index} decreasing max RPS from ${bucket.rpsLimit.toFixed(2)} to ${newRPSLimit.toFixed(2)} due to rate limit`,
  );
  bucket.rpsLimit = newRPSLimit;
  bucket.consecutiveSuccessfulRequests = 0;
};

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

      latencyMetadata: {
        latencies: [],
        successfulLatencies: 0,
        latencySum: 0,
      },
      expectedLatency: 200,

      requestTimestamps: [],
      consecutiveSuccessfulRequests: 0,
      rpsLimit: INITIAL_MAX_RPS,

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

      if (Math.random() < EPSILON) {
        const randomBucket =
          availableBuckets[
            Math.floor(Math.random() * availableBuckets.length)
          ]!;
        randomBucket.activeConnections++;
        return randomBucket;
      }

      const fastestBucket = availableBuckets.reduce((fastest, current) => {
        const currentLatency = current.expectedLatency;
        const fastestLatency = fastest.expectedLatency;

        if (currentLatency < fastestLatency * (1 - LATENCY_HURDLE_RATE)) {
          return current;
        }

        if (
          currentLatency <= fastestLatency &&
          current.activeConnections < fastest.activeConnections
        ) {
          return current;
        }

        return fastest;
      }, availableBuckets[0]!);

      fastestBucket.activeConnections++;
      return fastestBucket;
    };

    const fetch = async (body: any, bucket: Bucket): Promise<unknown> => {
      const startTime = performance.now();

      try {
        addRequestTimestamp(bucket);
        const response = await bucket.request(body);

        // Record latency
        const latency = performance.now() - startTime;
        addLatency(bucket, latency, true);

        // Update RPS metadata
        bucket.totalSuccessfulRequests++;
        bucket.consecutiveSuccessfulRequests++;
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

        const latency = performance.now() - startTime;
        addLatency(bucket, latency, false);

        bucket.totalFailedRequests++;

        if (
          err.code === 429 ||
          err.status === 429 ||
          err instanceof TimeoutError
        ) {
          if (bucket.isActive) {
            bucket.isActive = false;
            bucket.isJustActivated = false;

            decreaseMaxRPS(bucket);

            bucket.retryDelay =
              bucket.retryDelay === 0 || err instanceof TimeoutError
                ? INITIAL_RETRY_DELAY
                : Math.min(bucket.retryDelay * BACKOFF_FACTOR, MAX_RETRY_DELAY);

            scheduleBucketActivation(bucket);
          }
        }

        throw error;
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
      await fetch(body, bucket).then(resolve).catch(reject);
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
      retryCount,
      timeout: 0,
      type: "dynamicLB",
    } as TransportConfig);
  };
};
