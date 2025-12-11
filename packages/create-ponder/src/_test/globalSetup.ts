import dotenv from "dotenv";

async function globalSetup() {
  dotenv.config({ path: ".env.local" });

  if (!process.env.ETHERSCAN_API_KEY) {
    console.warn('Environment variable "ETHERSCAN_API_KEY" not found');
  }
}

if ("bun" in process.versions) {
  require("bun:test").beforeAll(async () => {
    await globalSetup();
  });
}

export default globalSetup;
