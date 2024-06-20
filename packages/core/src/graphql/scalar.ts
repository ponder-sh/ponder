import { BuildError } from "@/common/errors.js";
import type { Scalar } from "@/schema/common.js";
import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLScalarType,
  GraphQLString,
} from "graphql";

const GraphQLBigInt = new GraphQLScalarType({
  name: "BigInt",
  serialize: (value) => String(value),
  parseValue: (value) => BigInt(value as any),
  parseLiteral: (value) => {
    if (value.kind === "StringValue") {
      return BigInt(value.value);
    } else {
      throw new BuildError(
        `Invalid value kind provided for field of type BigInt: ${value.kind}. Expected: StringValue`,
      );
    }
  },
});

export const SCALARS: { [type in Scalar]: GraphQLScalarType } = {
  int: GraphQLInt,
  float: GraphQLFloat,
  string: GraphQLString,
  boolean: GraphQLBoolean,
  bigint: GraphQLBigInt,
  hex: GraphQLString,
};
