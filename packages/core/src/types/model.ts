import type { Prettify } from "./utils";

type HasOnlyIdProperty<T> = Exclude<keyof T, "id"> extends never ? true : false;

type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type HasRequiredPropertiesOtherThanId<T> = Exclude<
  RequiredKeys<T>,
  "id"
> extends never
  ? false
  : true;

type OperatorMap<
  TField extends
    | string
    | bigint
    | number
    | boolean
    | (string | bigint | number | boolean)[]
> = {
  equals?: TField;
  not?: TField;
} & (TField extends any[]
  ? {
      contains?: TField[number];
      not_contains?: TField[number];
    }
  : {
      in?: TField[];
      not_in?: TField[];
    }) &
  (TField extends string
    ? {
        starts_with?: TField;
        ends_with?: TField;
        not_starts_with?: TField;
        not_ends_with?: TField;
      }
    : {}) &
  (TField extends number | bigint
    ? {
        gt?: TField;
        gte?: TField;
        lt?: TField;
        lte?: TField;
      }
    : {});

type ModelWhereInput<
  T extends {
    [key: string]:
      | string
      | bigint
      | number
      | boolean
      | (string | bigint | number | boolean)[];
  }
> = {
  [FieldName in keyof T]?: T[FieldName] | Prettify<OperatorMap<T[FieldName]>>;
};

// type ExampleModel = {
//   id: string;
//   counts: number[];
//   name: string;
// };

// type ExampleWhereInput = ModelWhereInput<ExampleModel>;

export type Model<T extends { id: string | number | bigint }> = {
  create: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
        ? { data: Prettify<Omit<T, "id">> }
        : { data?: Prettify<Omit<T, "id">> })
    >
  ) => Promise<Prettify<T>>;

  update: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
        ? {
            data:
              | Prettify<Omit<Partial<T>, "id">>
              | ((options: {
                  current: Prettify<T>;
                }) => Prettify<Omit<Partial<T>, "id">>);
          }
        : {
            data?:
              | Prettify<Omit<Partial<T>, "id">>
              | ((options: {
                  current: Prettify<T>;
                }) => Prettify<Omit<Partial<T>, "id">>);
          })
    >
  ) => Promise<Prettify<T>>;

  upsert: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { create?: never; update?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
        ? {
            create: Prettify<Omit<T, "id">>;
            update:
              | Prettify<Omit<Partial<T>, "id">>
              | ((options: {
                  current: Prettify<T>;
                }) => Prettify<Omit<Partial<T>, "id">>);
          }
        : {
            create?: Prettify<Omit<T, "id">>;
            update?:
              | Prettify<Omit<Partial<T>, "id">>
              | ((options: {
                  current: Prettify<T>;
                }) => Prettify<Omit<Partial<T>, "id">>);
          })
    >
  ) => Promise<Prettify<T>>;

  findUnique: (options: { id: T["id"] }) => Promise<Prettify<T> | null>;

  findMany: (options?: {
    where?: ModelWhereInput<T>;
  }) => Promise<Prettify<T>[]>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};
