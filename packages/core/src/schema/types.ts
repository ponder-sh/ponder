import type {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLScalarType,
  TypeNode,
} from "graphql";

export type FieldKind = "SCALAR" | "ENUM" | "LIST" | "RELATIONSHIP" | "DERIVED";

export type ScalarTypeName =
  | "Boolean"
  | "Int"
  | "String"
  | "BigInt"
  | "Bytes"
  | "Float";

export type ScalarField = {
  name: string;
  kind: "SCALAR";
  notNull: boolean;
  originalFieldType: TypeNode;
  scalarTypeName: ScalarTypeName;
  scalarGqlType: GraphQLScalarType;
};

export type EnumField = {
  name: string;
  kind: "ENUM";
  notNull: boolean;
  originalFieldType: TypeNode;
  enumGqlType: GraphQLEnumType;
  enumValues: string[];
};

export type ListField = {
  name: string;
  kind: "LIST";
  baseGqlType: GraphQLScalarType | GraphQLEnumType;
  originalFieldType: TypeNode;
  notNull: boolean;
  isListElementNotNull: boolean;
};

export type RelationshipField = {
  name: string;
  kind: "RELATIONSHIP";
  baseGqlType: GraphQLInputObjectType;
  originalFieldType: TypeNode;
  notNull: boolean;
  relatedEntityName: string;
  relatedEntityIdType: GraphQLScalarType & { name: ScalarTypeName };
};

export type DerivedField = {
  name: string;
  kind: "DERIVED";
  baseGqlType: GraphQLInputObjectType;
  originalFieldType: TypeNode;
  notNull: boolean;
  derivedFromEntityName: string;
  derivedFromFieldName: string;
};

export type Field =
  | ScalarField
  | EnumField
  | ListField
  | RelationshipField
  | DerivedField;

export type Entity = {
  name: string;
  gqlType: GraphQLObjectType;
  isImmutable: boolean;
  fields: Field[];
  fieldByName: { id: ScalarField } & Record<string, Field>;
};

export type Schema = {
  entities: Entity[];
};
