import { Analytics, type TrackParams } from "@segment/analytics-node";
import type { NextApiRequest, NextApiResponse } from "next";
import { PostHog } from "posthog-node";

if (!process.env.SEGMENT_WRITE_KEY)
  throw new Error('Missing required environment variable "SEGMENT_WRITE_KEY".');
if (!process.env.POSTHOG_PROJECT_API_KEY)
  throw new Error(
    'Missing required environment variable "POSTHOG_PROJECT_API_KEY".',
  );

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

const asyncTrack = (payload: TrackParams) => {
  return new Promise<void>((resolve, reject) => {
    analytics.track(payload, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
};

export default async function forwardTelemetry(
  req: NextApiRequest,
  res: NextApiResponse,
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
