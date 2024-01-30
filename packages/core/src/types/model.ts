import type { OrderByInput, WhereInput } from "@/indexing-store/store.js";
import type { Hex } from "viem";
import type {
  HasOnlyIdProperty,
  HasRequiredPropertiesOtherThanId,
  Prettify,
} from "./utils.js";

export type DatabaseModel<T extends { id: string | number | bigint | Hex }> = {
  create: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
          ? { data: Prettify<Omit<T, "id">> }
          : { data?: Prettify<Omit<T, "id">> })
    >,
  ) => Promise<Prettify<T>>;

  createMany: (options: { data: Prettify<T>[] }) => Promise<Prettify<T>[]>;

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
    >,
  ) => Promise<Prettify<T>>;

  updateMany: (options: {
    where: Prettify<WhereInput<T>>;
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
    >,
  ) => Promise<Prettify<T>>;

  findUnique: (options: { id: T["id"] }) => Promise<Prettify<T> | null>;

  findMany: (options?: {
    where?: Prettify<WhereInput<T>>;
    orderBy?: Prettify<OrderByInput<T>>;
    limit?: number;
    before?: string;
    after?: string;
  }) => Promise<{
    items: Prettify<T>[];
    pageInfo: {
      startCursor: string | null;
      endCursor: string | null;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};
