import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import forwardTelemetry from "./telemetry.js";

// Convert Node.js request/response to Vercel format
const convertToVercelFormat = (req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  
  req.on("data", (chunk) => {
    body += chunk.toString();
  });
  
  req.on("end", async () => {
    try {
      // Parse JSON body
      const parsedBody = body ? JSON.parse(body) : {};
      
      // Create Vercel-style request object
      const vercelReq = {
        method: req.method,
        body: parsedBody,
        headers: req.headers,
      } as any;
      
      // Create Vercel-style response object
      const vercelRes = {
        status: (code: number) => {
          res.statusCode = code;
          return vercelRes;
        },
        json: (data: any) => {
          res.end(JSON.stringify(data));
          return vercelRes;
        },
      } as any;
      
      // Call the forwardTelemetry function
      await forwardTelemetry(vercelReq, vercelRes);
    } catch (error) {
      console.error("Error processing request:", error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
};

const server = createServer(convertToVercelFormat);

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`🚀 Local telemetry server running on http://localhost:${PORT}`);
  console.log("📊 Ready to receive telemetry requests");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down telemetry server...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down telemetry server...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
}); 