import { Analytics, TrackParams } from "@segment/analytics-node";
import { NextApiRequest, NextApiResponse } from "next";

if (!process.env.SEGMENT_WRITE_KEY) {
  throw new Error('Missing required environment variable "SEGMENT_WRITE_KEY".');
}

const analytics = new Analytics({
  writeKey: process.env.SEGMENT_WRITE_KEY,
  /**
   * Disable batching so that event are submitted immediately.
   * See https://segment.com/docs/connections/sources/catalog/libraries/server/node/#batching
   */
  maxEventsInBatch: 1,
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
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: `Method ${req.method} Not Allowed`,
    });
  }

  try {
    await asyncTrack(req.body);
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("Error processing telemetry data:", {
      error: e,
      body: req.body,
    });
    res.status(500).json({ error: "Server error" });
  }
}
