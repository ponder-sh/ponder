declare module "@/generated" {
  import type { Virtual } from "ponder";
  type config = typeof import("ponda").config;
  type schema = typeof import("ponda").schema;

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
  export type ApiContext = Virtual.ApiContext<schema>;
  export type IndexingFunctionArgs<name extends EventNames = EventNames> =
    Virtual.IndexingFunctionArgs<config["default"], schema, name>;
}

declare module "ponder:schema" {
  const schema: typeof import("ponda").schema;

  export { schema as default };
}

declare module "ponder:api" {
  import type { Virtual } from "ponder";
  type schema = typeof import("ponda").schema;

  export const db: Virtual.Drizzle<typeof schema>;
}
