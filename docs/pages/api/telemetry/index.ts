import { NextApiRequest, NextApiResponse } from "next";

async function forwardTelemetry(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    try {
      if (!process.env.SEGMENT_WRITE_KEY) {
        throw new Error("No Segment write key found.");
      }

      const telemetryPayload = req.body;
      const segmentWriteKey = process.env.SEGMENT_WRITE_KEY;
      const segmentEndpoint = "https://api.segment.io/v1/track";
      const authorization = `${segmentWriteKey}:`;

      const response = await fetch(segmentEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(authorization).toString(
            "base64"
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(telemetryPayload),
      });

      if (response.ok) {
        res.status(200).json({
          message: "Telemetry data processed successfully.",
        });
      } else {
        const errorMessage = response.statusText;
        console.error("Error processing telemetry data", errorMessage);
        res.status(response.status).json({
          error: "An error occurred while processing telemetry data.",
        });
      }
    } catch (error) {
      console.error("Error forwarding telemetry data to Segment API:", error);
      res
        .status(500)
        .json({ error: "An error occurred while processing telemetry data." });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

export default forwardTelemetry;
