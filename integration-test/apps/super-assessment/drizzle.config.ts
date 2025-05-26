import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: { url: process.env.DATABASE_URL! },
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
