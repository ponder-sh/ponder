import type {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLObjectType,
  GraphQLScalarType,
  TypeNode,
} from "graphql";

export enum FieldKind {
  ID,
  SCALAR,
  ENUM,
  LIST,
  RELATIONSHIP,
  DERIVED,
}

export type IDField = {
  name: string;
  kind: FieldKind.ID;
  baseGqlType: GraphQLScalarType;
  originalFieldType: TypeNode;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
};

export type ScalarField = {
  name: string;
  kind: FieldKind.SCALAR;
  baseGqlType: GraphQLScalarType;
  originalFieldType: TypeNode;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
};

export type EnumField = {
  name: string;
  kind: FieldKind.ENUM;
  baseGqlType: GraphQLEnumType;
  originalFieldType: TypeNode;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
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
};

export type RelationshipField = {
  name: string;
  kind: FieldKind.RELATIONSHIP;
  baseGqlType: GraphQLInputObjectType;
  originalFieldType: TypeNode;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  relatedEntityName: string;
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
  | IDField
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

export type PonderSchema = {
  entities: Entity[];
  entityByName: Record<string, Entity>;
};
