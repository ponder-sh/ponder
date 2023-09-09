import dotenv from "dotenv";

export default async function () {
  dotenv.config({ path: ".env.local" });

  if (!process.env.ETHERSCAN_API_KEY) {
    console.warn('Environment variable "ETHERSCAN_API_KEY" not found');
  }

  // The create-ponder tests run the codegen command for each test project.
  // We don't want to emit telemetry for these tests; this is a simple way to suppress it.
  process.env.PONDER_TELEMETRY_DISABLED = "true";
}
