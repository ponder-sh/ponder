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

export const dynamicLB = (_transports: Transport[]): Transport => {
  const RPC_USAGE = Array.from({ length: _transports.length }, () => ({
    s: 0,
    l: 0,
  })) as { s: number; l: number }[];

  return ({ chain, retryCount, timeout }) => {
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

    const queue: [EIP1193Parameters, PromiseWithResolvers<unknown>][] = [];

    const buckets = _transports.map((transport, index) => ({
      index,
      retryDelay: 0,

      activeConnections: 0,
      isActive: true,
      isJustActivated: false,

      latencies: [] as number[],
      expectedLatency: 0,
      requests: [] as number[],
      successfulRequests: 0,
      maxRPS: INITIAL_MAX_RPS,

      getExpectedLatency() {
        return this.expectedLatency;
      },
      addLatency(latency: number) {
        this.latencies.push(latency);
        if (this.latencies.length > LATENCY_WINDOW_SIZE) {
          this.latencies.shift();
        }

        this.expectedLatency =
          this.latencies.reduce((sum, lat) => sum + lat, 0) /
          this.latencies.length;
        RPC_USAGE[this.index]!.l = this.expectedLatency;
      },

      addRequestTimestamp() {
        const timestamp = Date.now() / 1000;
        this.requests.push(timestamp);
        while (timestamp - this.requests[0]! > 5) {
          this.requests.shift()!;
        }
      },
      getRps() {
        const timestamp = Date.now() / 1000;
        while (this.requests.length > 0 && timestamp - this.requests[0]! > 5) {
          this.requests.shift()!;
        }

        if (this.requests.length === 0) return 0;

        const t =
          this.requests[this.requests.length - 1]! - this.requests[0]! + 1;
        return this.requests.length / t;
      },
      isRPSSafe() {
        return this.getRps() < this.maxRPS;
      },
      increaseMaxRPS() {
        if (this.successfulRequests >= SUCCESS_WINDOW_SIZE) {
          const newMaxRPS = Math.min(
            this.maxRPS * RPS_INCREASE_FACTOR,
            MAX_RPS,
          );
          console.log(
            `Bucket ${this.index} increasing max RPS from ${this.maxRPS.toFixed(2)} to ${newMaxRPS.toFixed(2)} after ${this.successfulRequests} successful requests`,
          );
          this.maxRPS = newMaxRPS;
          this.successfulRequests = 0;
        }
      },
      decreaseMaxRPS() {
        const newMaxRPS = Math.max(this.maxRPS * RPS_DECREASE_FACTOR, MIN_RPS);
        console.log(
          `Bucket ${this.index} decreasing max RPS from ${this.maxRPS.toFixed(2)} to ${newMaxRPS.toFixed(2)} due to rate limit`,
        );
        this.maxRPS = newMaxRPS;
        this.successfulRequests = 0;
      },
      ...transport({
        retryCount: 0,
        timeout: timeout ?? DEFAULT_TIMEOUT,
        chain,
      }),
    }));

    const activationPromises: Promise<void>[] = [];

    const scheduleBucketActivation = (bucket: (typeof buckets)[0]) => {
      const promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          bucket.isActive = true;
          bucket.isJustActivated = true;
          console.log(
            `Bucket ${bucket.index} reactivated after ${bucket.retryDelay}ms delay`,
          );
          resolve();
        }, bucket.retryDelay);
      });
      activationPromises.push(promise);
      promise.then(() => {
        const index = activationPromises.indexOf(promise);
        if (index > -1) {
          activationPromises.splice(index, 1);
        }
      });
    };

    const getBucket = async (): Promise<(typeof buckets)[0]> => {
      const activeBuckets = buckets.filter(
        (b) =>
          b.isActive &&
          (!b.isJustActivated || b.activeConnections === 0) &&
          b.isRPSSafe(),
      );

      if (activeBuckets.length === 0) {
        const rpsSafePromise = new Promise<void>((resolve) => {
          const checkRPSSafe = () => {
            const safeBucket = buckets.find(
              (b) =>
                b.isActive &&
                (!b.isJustActivated || b.activeConnections === 0) &&
                (b as (typeof buckets)[0]).isRPSSafe(),
            );
            if (safeBucket) {
              resolve();
            } else {
              setTimeout(checkRPSSafe, 100); // Check every 100ms
            }
          };
          checkRPSSafe();
        });

        await Promise.race([Promise.race(activationPromises), rpsSafePromise]);

        return await new Promise((res) => setTimeout(res, 1)).then(getBucket);
      }

      const fastestBucket = activeBuckets.reduce((fastest, current) => {
        const currentLatency = current.getExpectedLatency();
        const fastestLatency = fastest.getExpectedLatency();

        if (currentLatency < fastestLatency) {
          return current;
        }
        return fastest;
      }, activeBuckets[0]!);

      fastestBucket.activeConnections++;
      return fastestBucket;
    };

    const fetch = async (
      body: any,
      tryCount: number,
      bucket_: (typeof buckets)[0] | undefined,
    ): Promise<unknown> => {
      const startTime = performance.now();

      let bucket: (typeof buckets)[0];
      if (bucket_ === undefined) {
        bucket = await getBucket();
      } else {
        bucket = bucket_;
      }

      try {
        bucket.addRequestTimestamp();
        const response = await bucket.request(body);

        // Record latency
        const latency = performance.now() - startTime;
        bucket.addLatency(latency);

        // Update RPS metadata
        RPC_USAGE[bucket.index]!.s += 1;
        bucket.successfulRequests++;
        bucket.increaseMaxRPS();

        if (bucket.isJustActivated) {
          bucket.isJustActivated = false;
        }
        if (bucket.isActive && bucket.retryDelay > 0) {
          bucket.retryDelay = 0;
        }

        return response;
      } catch (error) {
        const err = error as any;

        if (err.code === 429 || err.status === 429) {
          if (bucket.isActive) {
            bucket.isActive = false;
            bucket.isJustActivated = false;

            bucket.decreaseMaxRPS();

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

            bucket.decreaseMaxRPS();

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

      const [body, { reject, resolve }] = queue.shift()!;
      await fetch(body, 1, bucket).then(resolve).catch(reject);
    };

    const printRPCUsage = () => {
      const totalRequests = RPC_USAGE.reduce((acc, cur) => acc + cur.s, 0);
      const usage = RPC_USAGE.map(
        ({ s, l }, index) =>
          `RPC ${index}: ${s} (${((s * 100) / totalRequests).toFixed(2)} %); expected latency: ${l}`,
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
        const p = promiseWithResolvers();
        queue.push([body, p]);
        await dispatch();
        return p.promise;
      },
      retryCount: 0,
      timeout: 0,
      type: "dynamicLB",
    } as TransportConfig);
  };
};
