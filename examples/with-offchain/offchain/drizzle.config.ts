import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./src/offchain.ts",
  dialect: "postgresql",
});
