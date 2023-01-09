import type { Ponder, PonderPlugin, PonderPluginBuilder } from "@ponder/core";

import { generateSchema } from "@/codegen/generateSchema";
import { generateSchemaTypes } from "@/codegen/generateSchemaTypes";
import { GraphqlServer } from "@/server";
import { buildGqlSchema } from "@/server/buildGqlSchema";

export type PonderGraphqlPluginOptions = {
  port?: number;
};

export const graphqlPlugin: PonderPluginBuilder<PonderGraphqlPluginOptions> = (
  options = {}
) => {
  return (ponder: Ponder) => new PonderGraphqlPlugin(ponder, options);
};

class PonderGraphqlPlugin implements PonderPlugin {
  ponder: Ponder;
  name = "graphql";

  port: number;
  server?: GraphqlServer;

  constructor(ponder: Ponder, options: PonderGraphqlPluginOptions) {
    this.ponder = ponder;

    if (process.env.PORT) {
      this.port = parseInt(process.env.PORT);
    } else if (options.port) {
      this.port = options.port;
    } else {
      this.port = 42069;
    }
  }

  setup = async () => {
    if (!this.ponder.schema) {
      return;
    }

    const gqlSchema = buildGqlSchema(this.ponder.schema);

    // Build Express GraphQL server
    this.server = new GraphqlServer(
      this.port,
      this.ponder.entityStore,
      this.ponder.logger
    );
    this.server.start(gqlSchema, this.port);

    await generateSchemaTypes(gqlSchema, this.ponder);
    generateSchema(gqlSchema, this.ponder);
  };

  reload = async () => {
    if (!this.ponder.schema) {
      return;
    }

    const gqlSchema = buildGqlSchema(this.ponder.schema);

    this.server?.start(gqlSchema, this.port);
  };

  teardown = async () => {
    this.server?.teardown();
  };
}
