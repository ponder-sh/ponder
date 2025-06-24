import { createClient } from "@clickhouse/client"
import { Analytics, type TrackParams } from "@segment/analytics-node";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PostHog } from "posthog-node";

if (!process.env.SEGMENT_WRITE_KEY)
  throw new Error('Missing required environment variable "SEGMENT_WRITE_KEY".');
if (!process.env.POSTHOG_PROJECT_API_KEY)
  throw new Error(
    'Missing required environment variable "POSTHOG_PROJECT_API_KEY".',
  );
if (!process.env.CLICKHOUSE_URL)
  throw new Error('Missing required environment variable "CLICKHOUSE_URL".');

const analytics = new Analytics({
  writeKey: process.env.SEGMENT_WRITE_KEY,
  /**
   * Disable batching so that event are submitted immediately.
   * See https://segment.com/docs/connections/sources/catalog/libraries/server/node/#batching
   */
  maxEventsInBatch: 1,
});

const client = new PostHog(process.env.POSTHOG_PROJECT_API_KEY, {
  host: "https://app.posthog.com",
  flushAt: 1,
  flushInterval: 0,
});

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL,
  database: process.env.CLICKHOUSE_DB ?? "telemetry",
  compression: {
    response: true,
    request: true,
  },
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 0,
    async_insert_busy_timeout_ms: 30_000,
  },
})

// Local buffer for batching requests
interface BufferedRequest {
  timestamp: Date;
  project_id: string;
  session_id: string;
  device_id: string;
  duration: number;
}

class RequestBuffer {
  #buffer: BufferedRequest[] = [];
  #currentBatchPromise: Promise<void> | null = null;
  #batchTimeout = 2000;

  async push(request: BufferedRequest): Promise<void> {
    if (!this.#currentBatchPromise) {
      this.#currentBatchPromise = this.#delayedProcessBatch();
    }

    this.#buffer.push(request);
    await this.#currentBatchPromise;
  }

  async #delayedProcessBatch(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.#batchTimeout));

    const requestsToFlush = [...this.#buffer];
    this.#buffer = [];
    this.#currentBatchPromise = null;

    if (requestsToFlush.length === 0) {
      return;
    }

    try {
      await this.#insertToClickHouse(requestsToFlush);
      console.log(`Successfully flushed ${requestsToFlush.length} requests to ClickHouse`);
    } catch (error) {
      console.error('Error flushing buffer to ClickHouse:', error);
      this.#buffer.unshift(...requestsToFlush);
      this.#currentBatchPromise = this.#delayedProcessBatch();
      throw error;
    }
  }

  async #insertToClickHouse(requests: BufferedRequest[]): Promise<void> {
    if (requests.length === 0) {
      return;
    }

    const valueSets = requests.map((_, index) =>
      `({timestamp_${index}:Int64}, reinterpretAsUInt64(unhex({project_id_${index}:String})), reinterpretAsUInt64(unhex({session_id_${index}:String})), reinterpretAsUInt64(unhex({device_id_${index}:String})), {duration_${index}:UInt32})`
    ).join(', ');

    const queryParams: Record<string, any> = {};
    requests.forEach((req, index) => {
      queryParams[`timestamp_${index}`] = Math.floor(req.timestamp.getTime() / 1000);
      queryParams[`project_id_${index}`] = req.project_id;
      queryParams[`session_id_${index}`] = req.session_id;
      queryParams[`device_id_${index}`] = req.device_id;
      queryParams[`duration_${index}`] = req.duration;
    });

    await clickhouse.command({
      query: `
        INSERT INTO telemetry_heartbeat 
          (timestamp, project_id, session_id, device_id, duration) VALUES
          ${valueSets}
      `,
      query_params: queryParams,
    });
  }

  async forceFlush(): Promise<void> {
    if (this.#currentBatchPromise) {
      await this.#currentBatchPromise;
    }

    if (this.#buffer.length > 0) {
      const requestsToFlush = [...this.#buffer];
      this.#buffer = [];
      this.#currentBatchPromise = null;

      await this.#insertToClickHouse(requestsToFlush);
      console.log(`Force flushed ${requestsToFlush.length} requests to ClickHouse`);
    }
  }
}

// Global buffer instance
const requestBuffer = new RequestBuffer();

// Cleanup on process exit
process.on('SIGINT', async () => {
  await requestBuffer.forceFlush();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await requestBuffer.forceFlush();
  process.exit(0);
});

const asyncTrack = (payload: TrackParams) => {
  return new Promise<void>((resolve, reject) => {
    analytics.track(payload, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
};

export default async function forwardTelemetry(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: `Method ${req.method} Not Allowed`,
    });
  }

  const body = req.body;

  const handleError = (error: unknown) => {
    console.error("Error processing telemetry data:", { error, body });
    return res.status(500).json({ error: "Server error" });
  };

  // If the event has an distinctId, it's a new Posthog event from >= 0.4.3
  if (body.distinctId) {
    client.on("error", handleError);
    client.capture(body);
    await client.shutdown();

    if (body.event === "lifecycle:heartbeat_send") {
      await requestBuffer.push({
        timestamp: new Date(),
        project_id: body.properties.project_id,
        session_id: body.properties.session_id,
        device_id: body.distinctId,
        duration: Math.round(+body.properties.duration_seconds),
      });
    } else if (body.event === "lifecycle:session_start") {
      await requestBuffer.push({
        timestamp: new Date(),
        project_id: body.properties.project_id,
        session_id: body.properties.session_id,
        device_id: body.distinctId,
        duration: 0,
      });
    }
  }
  // Otherwise, assume it's a Segment event
  else {
    try {
      await asyncTrack(body);
    } catch (error) {
      handleError(error);
    }
  }

  return res.status(200).json({ success: true });
}

