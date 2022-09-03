export enum FieldKind {
  ID,
  SCALAR,
  ENUM,
  LIST,
}

export type IDField = {
  name: string;
  kind: FieldKind.ID;
  gqlType: string;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  tsType: string;
};

export type ScalarField = {
  name: string;
  kind: FieldKind.SCALAR;
  gqlType: string;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  tsType: string;
};

export type EnumField = {
  name: string;
  kind: FieldKind.ENUM;
  gqlType: string;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: string;
  enumValues: string[];
};

export type ListField = {
  name: string;
  kind: FieldKind.LIST;
  gqlType: string;
  notNull: boolean;
  migrateUpStatement: string;
  sqlType: "text";
  tsBaseType: string;
};

export type Field = IDField | ScalarField | EnumField | ListField;

export type Entity = {
  name: string;
  fields: Field[];
};

export type PonderSchema = {
  entities: Record<string, Entity>;
};
