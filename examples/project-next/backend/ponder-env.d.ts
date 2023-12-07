declare module "@/generated" {
  import type { ExtractContext, PonderApp } from "@ponder/core";

  type Config = typeof import("./ponder.config.ts").default;
  type Schema = typeof import("./ponder.schema.ts").default;

  export const ponder: PonderApp<Config, Schema>;

  export type Context = ExtractContext<Config, Schema>;
}
