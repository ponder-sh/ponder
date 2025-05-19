import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: process.env.CONNECTION_STRING!,
  },
  dialect: "postgresql",
  schema: "./rpc/schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
