import { createClient } from "@clickhouse/client"
import type { VercelRequest, VercelResponse } from "@vercel/node";

if (!process.env.CLICKHOUSE_URL)
  throw new Error('Missing required environment variable "CLICKHOUSE_URL".');

const clickhouse = createClient({ url: process.env.CLICKHOUSE_URL, clickhouse_settings: {
  "async_insert": 1,
  "wait_for_async_insert": 0,
  "async_insert_busy_timeout_ms": 30_000,
} })

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

  // If the event has an distinctId, it's a new event from >= 0.4.3
  if (body.distinctId) {
    if (body.event === "lifecycle:heartbeat_send") {
      await clickhouse.insert({
        table: "telemetry.telemetry_heartbeat",
        format: "JSONEachRow",
        values: [{
          timestamp: Math.floor(Date.now() / 1000),
          project_id: BigInt(`0x${body.properties.project_id}`).toString(),
          session_id: BigInt(`0x${body.properties.session_id}`).toString(),
          device_id: BigInt(`0x${body.distinctId}`).toString(),
          duration: Math.round(+body.properties.duration_seconds),
        }],
      }).catch(handleError);
    } else if (body.event === "lifecycle:session_start") {

      await clickhouse.insert({
        table: "telemetry.telemetry_heartbeat",
        format: "JSONEachRow",
        values: [{
          timestamp: Math.floor(Date.now() / 1000),
          project_id: BigInt(`0x${body.properties.project_id}`).toString(),
          session_id: BigInt(`0x${body.properties.session_id}`).toString(),
          device_id: BigInt(`0x${body.distinctId}`).toString(),
          duration: 0,
        }],
      }).catch(handleError);
    }
  }

  return res.status(200).json({ success: true });
}
