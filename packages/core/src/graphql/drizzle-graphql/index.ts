import {
  type GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
  type GraphQLSchemaConfig,
} from "graphql";

import type { Drizzle } from "@/drizzle/index.js";
import { generateSchemaData } from "./pg.js";

type BuildSchemaConfig = {
  /**
   * Limits depth of generated relation fields on queries.
   * Expects non-negative integer or undefined.
   * Set value to `undefined` to not limit relation depth.
   * Set value to `0` to omit relations altogether.
   * Value is treated as if set to `undefined` by default.
   */
  relationsDepthLimit?: number;
};

export const buildSchema = <TDbClient extends Drizzle>(
  db: TDbClient,
  config?: BuildSchemaConfig,
) => {
  const schema = db._.fullSchema;
  if (!schema) {
    throw new Error(
      "Drizzle-GraphQL Error: Schema not found in drizzle instance. Make sure you're using drizzle-orm v0.30.9 or above and schema is passed to drizzle constructor!",
    );
  }

  if (typeof config?.relationsDepthLimit === "number") {
    if (config.relationsDepthLimit < 0) {
      throw new Error(
        "Drizzle-GraphQL Error: config.relationsDepthLimit is supposed to be nonnegative integer or undefined!",
      );
    }
    if (config.relationsDepthLimit !== ~~config.relationsDepthLimit) {
      throw new Error(
        "Drizzle-GraphQL Error: config.relationsDepthLimit is supposed to be nonnegative integer or undefined!",
      );
    }
  }

  const generatorOutput = generateSchemaData(
    db,
    schema,
    config?.relationsDepthLimit,
  );

  const { queries, inputs, types } = generatorOutput;

  const graphQLSchemaConfig: GraphQLSchemaConfig = {
    types: [...Object.values(inputs), ...Object.values(types)] as (
      | GraphQLInputObjectType
      | GraphQLObjectType
    )[],
    query: new GraphQLObjectType({ name: "Query", fields: queries }),
  };

  const outputSchema = new GraphQLSchema(graphQLSchemaConfig);

  return { schema: outputSchema, entities: generatorOutput };
};
