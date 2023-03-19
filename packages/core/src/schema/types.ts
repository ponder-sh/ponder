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

export type ScalarField = {
  name: string;
  kind: FieldKind.SCALAR;
  notNull: boolean;
  originalFieldType: TypeNode;
  scalarTypeName: string;
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
  migrateUpStatement: string;
  sqlType: "text";
  isListElementNotNull: boolean;
};

export type RelationshipField = {
  name: string;
  kind: FieldKind.RELATIONSHIP;
  baseGqlType: GraphQLInputObjectType;
  originalFieldType: TypeNode;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  relatedEntityId: string;
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
  id: string;
  name: string;
  gqlType: GraphQLObjectType;
  isImmutable: boolean;
  fields: Field[];
  fieldByName: Record<string, Field>;
};

export type Schema = {
  instanceId: string;
  entities: Entity[];
};
