import type { OrderByInput, WhereInput } from "@/indexing-store/store.js";
import type { UserTable } from "./schema.js";
import type {
  HasOnlyIdProperty,
  HasRequiredPropertiesOtherThanId,
  Prettify,
} from "./utils.js";

export type StoreMethod = Prettify<keyof DatabaseModel<any>>;

export type DatabaseModel<table extends UserTable> = {
  create: (
    options: Prettify<
      {
        id: table["id"];
      } & (HasOnlyIdProperty<table> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<table> extends true
          ? { data: Prettify<Omit<table, "id">> }
          : { data?: Prettify<Omit<table, "id">> })
    >,
  ) => Promise<Prettify<table>>;

  createMany: (options: { data: Prettify<table>[] }) => Promise<
    Prettify<table>[]
  >;

  update: (
    options: Prettify<
      {
        id: table["id"];
      } & (HasOnlyIdProperty<table> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<table> extends true
          ? {
              data:
                | Prettify<Omit<Partial<table>, "id">>
                | ((options: {
                    current: Prettify<table>;
                  }) => Prettify<Omit<Partial<table>, "id">>);
            }
          : {
              data?:
                | Prettify<Omit<Partial<table>, "id">>
                | ((options: {
                    current: Prettify<table>;
                  }) => Prettify<Omit<Partial<table>, "id">>);
            })
    >,
  ) => Promise<Prettify<table>>;

  updateMany: (options: {
    where: Prettify<WhereInput<table>>;
    data:
      | Prettify<Omit<Partial<table>, "id">>
      | ((options: {
          current: Prettify<table>;
        }) => Prettify<Omit<Partial<table>, "id">>);
  }) => Promise<Prettify<table>[]>;

  upsert: (
    options: Prettify<
      {
        id: table["id"];
      } & (HasOnlyIdProperty<table> extends true
        ? { create?: never; update?: never }
        : HasRequiredPropertiesOtherThanId<table> extends true
          ? {
              create: Prettify<Omit<table, "id">>;
              update:
                | Prettify<Omit<Partial<table>, "id">>
                | ((options: {
                    current: Prettify<table>;
                  }) => Prettify<Omit<Partial<table>, "id">>);
            }
          : {
              create?: Prettify<Omit<table, "id">>;
              update?:
                | Prettify<Omit<Partial<table>, "id">>
                | ((options: {
                    current: Prettify<table>;
                  }) => Prettify<Omit<Partial<table>, "id">>);
            })
    >,
  ) => Promise<Prettify<table>>;

  findUnique: (options: { id: table["id"] }) => Promise<Prettify<table> | null>;

  findMany: (options?: {
    where?: Prettify<WhereInput<table>>;
    orderBy?: Prettify<OrderByInput<table>>;
    limit?: number;
    before?: string;
    after?: string;
  }) => Promise<{
    items: Prettify<table>[];
    pageInfo: {
      startCursor: string | null;
      endCursor: string | null;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }>;

  delete: (options: { id: table["id"] }) => Promise<boolean>;
};
