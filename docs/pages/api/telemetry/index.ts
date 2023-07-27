import { Analytics } from "@segment/analytics-node";
import { NextApiRequest, NextApiResponse } from "next";

export default async function forwardTelemetry(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  if (!process.env.SEGMENT_WRITE_KEY) {
    console.error('Missing required environment variable "SEGMENT_WRITE_KEY".');
    return res
      .status(500)
      .json({ error: "An error occurred while processing telemetry data." });
  }

  try {
    const analytics = new Analytics({
      writeKey: process.env.SEGMENT_WRITE_KEY,
    });

    await analytics.track({
      ...req.body,
    });

    res.status(200).json({
      message: "Telemetry data processed successfully.",
    });
  } catch (error) {
    console.error("Error forwarding telemetry data to Segment API:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing telemetry data." });
  }
}
