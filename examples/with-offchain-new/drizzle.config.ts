import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./schemas/offchain.schema.ts",
  dialect: "postgresql",
});
