declare module "@/generated" {
  import type { ExtractContext, PonderApp } from "@ponder/core";

  type Config = typeof import("./ponder.config.js").default;
  type Schema = typeof import("./ponder.schema.js").default;

  export const ponder: PonderApp<Config, Schema>;

  export type Context = ExtractContext<Config, Schema>;
}
