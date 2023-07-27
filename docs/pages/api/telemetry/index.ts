import { Analytics } from "@segment/analytics-node";
import { NextRequest, NextResponse } from "next/server";

export const config = {
  runtime: "edge",
};

export default async function forwardTelemetry(req: NextRequest) {
  if (!process.env.SEGMENT_WRITE_KEY) {
    console.error('Missing required environment variable "SEGMENT_WRITE_KEY".');
    return NextResponse.json(
      {
        error: `Server error`,
      },
      { status: 500 }
    );
  }

  if (req.method !== "POST") {
    return NextResponse.json(
      {
        error: `Method ${req.method} Not Allowed`,
      },
      { status: 405 }
    );
  }

  const analytics = new Analytics({
    writeKey: process.env.SEGMENT_WRITE_KEY,
  });

  const data = await req.json();

  NextResponse.json(
    {
      message: "Telemetry data processed successfully.",
    },
    { status: 200 }
  );

  await analytics.track({
    ...data,
  });
}
