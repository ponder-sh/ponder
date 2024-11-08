// Modified from https://github.com/taion/graphql-type-json/blob/master/src/index.js
import {
  type GraphQLScalarLiteralParser,
  GraphQLScalarType,
  Kind,
  type ObjectValueNode,
  type ValueNode,
  print,
} from "graphql";

export const GraphQLJSON = new GraphQLScalarType({
  name: "JSON",
  description:
    "The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf).",
  serialize: (x) => x,
  parseValue: (x) => x,
  parseLiteral: (ast, variables) => {
    if (ast.kind !== Kind.OBJECT) {
      throw new TypeError(
        `JSONObject cannot represent non-object value: ${print(ast)}`,
      );
    }

    return parseObject(ast, variables);
  },
});

const parseLiteral = (
  ast: ValueNode,
  variables: Parameters<GraphQLScalarType["parseLiteral"]>[1],
): ReturnType<GraphQLScalarLiteralParser<unknown>> => {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number.parseFloat(ast.value);
    case Kind.OBJECT:
      return parseObject(ast, variables);
    case Kind.LIST:
      return ast.values.map((n) => parseLiteral(n, variables));
    case Kind.NULL:
      return null;
    case Kind.VARIABLE:
      return variables ? variables[ast.name.value] : undefined;
    default:
      throw new TypeError(`JSON cannot represent value: ${print(ast)}`);
  }
};

const parseObject = (
  ast: ObjectValueNode,
  variables: Parameters<GraphQLScalarType["parseLiteral"]>[1],
) => {
  const value = Object.create(null);
  ast.fields.forEach((field) => {
    value[field.name.value] = parseLiteral(field.value, variables);
  });

  return value;
};
