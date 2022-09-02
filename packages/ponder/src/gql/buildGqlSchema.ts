import { GraphQLFieldConfig, GraphQLObjectType, GraphQLSchema } from "graphql";

import { buildPluralField } from "./buildPluralField";
import { buildSingularField } from "./buildSingularField";
import { getEntities, getUserDefinedTypes } from "./helpers";
import type { Context, Source } from "./types";

const buildGqlSchema = (userSchema: GraphQLSchema): GraphQLSchema => {
  const userDefinedTypes = getUserDefinedTypes(userSchema);

  const entityTypes = getEntities(userSchema);

  const fields: { [fieldName: string]: GraphQLFieldConfig<Source, Context> } =
    {};

  for (const entityType of entityTypes) {
    const singularFieldName =
      entityType.name.charAt(0).toLowerCase() + entityType.name.slice(1);
    fields[singularFieldName] = buildSingularField(entityType);

    const pluralFieldName = singularFieldName + "s";
    fields[pluralFieldName] = buildPluralField(entityType, userDefinedTypes);
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: fields,
  });

  const schema = new GraphQLSchema({ query: queryType });

  return schema;
};

export { buildGqlSchema };
