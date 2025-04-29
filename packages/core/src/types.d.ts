declare module "ponder:registry" {
  import type { Virtual } from "ponder";
  type config = typeof import("ponder:internal").config;
  type schema = typeof import("ponder:internal").schema;

  export const ponder: Virtual.Registry<config["default"], schema>;

  export type EventNames = Virtual.EventNames<config["default"]>;
  export type Event<name extends EventNames = EventNames> = Virtual.Event<
    config["default"],
    name
  >;
  export type Context<name extends EventNames = EventNames> = Virtual.Context<
    config["default"],
    schema,
    name
  >;
  export type IndexingFunctionArgs<name extends EventNames = EventNames> =
    Virtual.IndexingFunctionArgs<config["default"], schema, name>;
}

declare module "ponder:schema" {
  const schema: typeof import("ponder:internal").schema;
  export { schema as default };
}

declare module "ponder:api" {
  import type { ReadonlyDrizzle } from "ponder";
  import type { PublicClient } from "viem";

  type schema = typeof import("ponder:internal").schema;
  type config = typeof import("ponder:internal").config;

  export const db: ReadonlyDrizzle<schema>;
  export const publicClients: {
    [chainName in keyof config["default"]["chains"]]: PublicClient;
  };
}
