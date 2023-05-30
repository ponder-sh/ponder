import type {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLObjectType,
  GraphQLScalarType,
  TypeNode,
} from "graphql";

export enum FieldKind {
  SCALAR,
  ENUM,
  LIST,
  RELATIONSHIP,
  DERIVED,
}

export type ScalarTypeName =
  | "Boolean"
  | "Int"
  | "String"
  | "BigInt"
  | "Bytes"
  | "Float";

export type ScalarField = {
  name: string;
  kind: FieldKind.SCALAR;
  notNull: boolean;
  originalFieldType: TypeNode;
  scalarTypeName: ScalarTypeName;
  scalarGqlType: GraphQLScalarType;
};

export type EnumField = {
  name: string;
  kind: FieldKind.ENUM;
  notNull: boolean;
  originalFieldType: TypeNode;
  enumGqlType: GraphQLEnumType;
  enumValues: string[];
};

export type ListField = {
  name: string;
  kind: FieldKind.LIST;
  baseGqlType: GraphQLInputType;
  originalFieldType: TypeNode;
  notNull: boolean;
  isListElementNotNull: boolean;
};

export type RelationshipField = {
  name: string;
  kind: FieldKind.RELATIONSHIP;
  baseGqlType: GraphQLInputObjectType;
  originalFieldType: TypeNode;
  notNull: boolean;
  relatedEntityName: string;
  relatedEntityIdTypeName: ScalarTypeName;
};

export type DerivedField = {
  name: string;
  kind: FieldKind.DERIVED;
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
  fieldByName: Record<string, Field>;
};

export type Schema = {
  entities: Entity[];
};
