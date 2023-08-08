import { Analytics } from "@segment/analytics-node";
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

export default async function forwardTelemetry(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: `Method ${req.method} Not Allowed`,
    });
  }

  res.status(200).json({
    message: "Telemetry data processed successfully.",
  });

  try {
    await analytics.track(req.body);
    console.log("Telemetry data processed successfully.");
  } catch (e) {
    console.error("Error processing telemetry data:", e);
  }
}
