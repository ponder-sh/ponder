import dotenv from "dotenv";

export default async function () {
  dotenv.config({ path: ".env.local" });

  if (!process.env.ETHERSCAN_API_KEY) {
    console.warn('Environment variable "ETHERSCAN_API_KEY" not found');
  }
}
