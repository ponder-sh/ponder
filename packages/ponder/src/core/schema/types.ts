import type {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLObjectType,
  GraphQLScalarType,
} from "graphql";

type GraphQLType = GraphQLObjectType | GraphQLScalarType | GraphQLEnumType;

export enum FieldKind {
  ID,
  SCALAR,
  ENUM,
  LIST,
  RELATIONSHIP,
}

export type IDField = {
  name: string;
  kind: FieldKind.ID;
  baseGqlType: GraphQLScalarType;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
};

export type ScalarField = {
  name: string;
  kind: FieldKind.SCALAR;
  baseGqlType: GraphQLScalarType;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
};

export type EnumField = {
  name: string;
  kind: FieldKind.ENUM;
  baseGqlType: GraphQLEnumType;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  enumValues: string[];
};

export type ListField = {
  name: string;
  kind: FieldKind.LIST;
  baseGqlType: GraphQLInputType;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: "text";
};

export type RelationshipField = {
  name: string;
  kind: FieldKind.RELATIONSHIP;
  baseGqlType: GraphQLInputObjectType;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  relatedEntityName: string;
};

export type Field =
  | IDField
  | ScalarField
  | EnumField
  | ListField
  | RelationshipField;

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
