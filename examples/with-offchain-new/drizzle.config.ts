import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./schemas/offchain.ts",
  dialect: "postgresql",
});
