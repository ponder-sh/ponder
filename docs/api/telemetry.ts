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

const clickhouse = createClient({ url: process.env.CLICKHOUSE_URL })

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
      await clickhouse.exec({
        query: `
    INSERT INTO telemetry_heartbeat 
      (timestamp, project_id, session_id, device_id, duration) VALUES
      (
        now(), 
        reinterpretAsUInt64(unhex({project_id:String})), 
        reinterpretAsUInt64(unhex({session_id:String})),
        reinterpretAsUInt64(unhex({device_id:String})),
        {duration:UInt32}
      )`,
        query_params: {
          project_id: body.properties.project_id, 
          session_id: body.properties.session_id,
          device_id: body.distinctId,
          duration: Math.round(+body.properties.duration_seconds),
        },
        clickhouse_settings:{
          "async_insert": 1,
          "async_insert_busy_timeout_ms": 30_000,
        },
      }).catch(handleError);
    } else if (body.event === "lifecycle:session_start") {
      await clickhouse.exec({
        query: `
    INSERT INTO telemetry_heartbeat 
      (timestamp, project_id, session_id, device_id, duration) VALUES
      (
        now(), 
        reinterpretAsUInt64(unhex({project_id:String})), 
        reinterpretAsUInt64(unhex({session_id:String})),
        reinterpretAsUInt64(unhex({device_id:String})),
        {duration:UInt32}
      )`,
        query_params: {
          project_id: body.properties.project_id, 
          session_id: body.properties.session_id,
          device_id: body.distinctId,
          duration: 0,
        },
        clickhouse_settings:{
          "async_insert": 1,
          "async_insert_busy_timeout_ms": 30_000,
        },
      }).catch(handleError);
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
