import type { OrderByInput, WhereInput } from "@/user-store/store";

import type {
  HasOnlyIdProperty,
  HasRequiredPropertiesOtherThanId,
  Prettify,
} from "./utils";

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

  createMany: (options: { data: T[] }) => Promise<Prettify<T>[]>;

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

  updateMany: (options: {
    where?: WhereInput<T>;
    data:
      | Prettify<Omit<Partial<T>, "id">>
      | ((options: {
          current: Prettify<T>;
        }) => Prettify<Omit<Partial<T>, "id">>);
  }) => Promise<Prettify<T>[]>;

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
    where?: WhereInput<T>;
    skip?: number;
    take?: number;
    orderBy?: OrderByInput<T>;
  }) => Promise<Prettify<T>[]>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};
