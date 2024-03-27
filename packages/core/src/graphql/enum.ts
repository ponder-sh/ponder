import type { Schema } from "@/schema/types.js";
import { GraphQLEnumType } from "graphql";

export function buildEnumTypes({ schema }: { schema: Schema }) {
  const enumTypes: Record<string, GraphQLEnumType> = {};

  for (const [enumName, _enum] of Object.entries(schema.enums)) {
    enumTypes[enumName] = new GraphQLEnumType({
      name: enumName,
      values: _enum.reduce(
        (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
        {},
      ),
    });
  }

  return { enumTypes };
}
