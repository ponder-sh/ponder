import { Analytics } from "@segment/analytics-node";
import { NextApiRequest, NextApiResponse } from "next";

export default async function forwardTelemetry(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!process.env.SEGMENT_WRITE_KEY) {
    console.error('Missing required environment variable "SEGMENT_WRITE_KEY".');
    return res.status(500).json({
      error: `Server error`,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: `Method ${req.method} Not Allowed`,
    });
  }

  const analytics = new Analytics({
    writeKey: process.env.SEGMENT_WRITE_KEY,
  });

  res.status(200).json({
    message: "Telemetry data processed successfully.",
  });

  await analytics.track({
    ...req.body,
  });
}
