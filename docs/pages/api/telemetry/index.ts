import { Analytics } from "@segment/analytics-node";
import { NextApiRequest, NextApiResponse } from "next";

if (!process.env.SEGMENT_WRITE_KEY) {
  throw new Error('Missing required environment variable "SEGMENT_WRITE_KEY".');
}

const analytics = new Analytics({
  writeKey: process.env.SEGMENT_WRITE_KEY,
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

  await analytics.track(req.body);
}
