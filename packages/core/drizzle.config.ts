import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/sync-store/schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
