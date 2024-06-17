import type { Prettify } from "@/types/utils.js";
import type {
  EnumColumn,
  Index,
  JSONColumn,
  ReferenceColumn,
  Scalar,
  ScalarColumn,
} from "./common.js";

type Optional<column extends BuilderScalarColumn> = () => BuilderScalarColumn<
  column[" scalar"],
  true,
  column[" list"]
>;

const optional =
  <column extends BuilderScalarColumn>(col: column): Optional<column> =>
  // @ts-expect-error
  () => {
    const newCol = {
      " type": col[" type"],
      " scalar": col[" scalar"],
      " optional": true,
      " list": col[" list"],
    } as const;

    if (newCol[" list"]) {
      return newCol;
    } else {
      return {
        ...newCol,
        list: list(newCol),
        references: references(newCol),
      };
    }
  };

type List<column extends BuilderScalarColumn> = () => BuilderScalarColumn<
  column[" scalar"],
  column[" optional"],
  true
>;

const list =
  <column extends BuilderScalarColumn>(col: column): List<column> =>
  // @ts-expect-error
  () => {
    const newCol = {
      " type": col[" type"],
      " scalar": col[" scalar"],
      " optional": col[" optional"],
      " list": true,
    } as const;

    if (newCol[" optional"]) {
      return newCol;
    } else {
      return {
        ...newCol,
        optional: optional(newCol),
      };
    }
  };

type EnumOptional<column extends BuilderEnumColumn> = () => BuilderEnumColumn<
  column[" enum"],
  true,
  column[" list"]
>;

const enumOptional =
  <column extends BuilderEnumColumn>(col: column): EnumOptional<column> =>
  // @ts-expect-error
  () => {
    const newCol = {
      " type": col[" type"],
      " enum": col[" enum"],
      " optional": true,
      " list": col[" list"],
    } as const;

    if (newCol[" list"]) {
      return newCol;
    } else {
      return {
        ...newCol,
        list: enumList(newCol),
      };
    }
  };

type EnumList<column extends BuilderEnumColumn> = () => BuilderEnumColumn<
  column[" enum"],
  column[" optional"],
  true
>;

const enumList =
  <column extends BuilderEnumColumn>(col: column): EnumList<column> =>
  // @ts-expect-error
  () => {
    const newCol = {
      " type": col[" type"],
      " enum": col[" enum"],
      " optional": col[" optional"],
      " list": true,
    } as const;

    if (newCol[" optional"]) {
      return newCol;
    } else {
      return {
        ...newCol,
        optional: enumOptional(newCol),
      };
    }
  };

type Asc<index extends Index> = () => BuilderIndex<
  index[" column"],
  "asc",
  index[" nulls"]
>;

const asc =
  <index extends BuilderIndex>(i: index): Asc<index> =>
  // @ts-expect-error
  () => {
    const newIndex = {
      " type": i[" type"],
      " column": i[" column"],
      " order": "asc",
      " nulls": i[" nulls"],
    } as const;

    if (newIndex[" nulls"] === undefined) {
      return {
        ...newIndex,
        nullsFirst: nullsFirst(newIndex),
        nullsLast: nullsLast(newIndex),
      };
    } else {
      return newIndex;
    }
  };

type Desc<index extends BuilderIndex> = () => BuilderIndex<
  index[" column"],
  "desc",
  index[" nulls"]
>;

const desc =
  <index extends BuilderIndex>(i: index): Desc<index> =>
  // @ts-expect-error
  () => {
    const newIndex = {
      " type": i[" type"],
      " column": i[" column"],
      " order": "desc",
      " nulls": i[" nulls"],
    } as const;

    if (newIndex[" nulls"] === undefined) {
      return {
        ...newIndex,
        nullsFirst: nullsFirst(newIndex),
        nullsLast: nullsLast(newIndex),
      };
    } else {
      return newIndex;
    }
  };

type NullsFirst<index extends BuilderIndex> = () => BuilderIndex<
  index[" column"],
  index[" order"],
  "first"
>;

const nullsFirst =
  <index extends BuilderIndex>(i: index): NullsFirst<index> =>
  // @ts-expect-error
  () => {
    const newIndex = {
      " type": i[" type"],
      " column": i[" column"],
      " order": i[" order"],
      " nulls": "first",
    } as const;

    if (newIndex[" order"] === undefined) {
      return {
        ...newIndex,
        asc: asc(newIndex),
        desc: desc(newIndex),
      };
    } else {
      return newIndex;
    }
  };

type NullsLast<index extends BuilderIndex> = () => BuilderIndex<
  index[" column"],
  index[" order"],
  "last"
>;

const nullsLast =
  <index extends BuilderIndex>(i: index): NullsLast<index> =>
  // @ts-expect-error
  () => {
    const newIndex = {
      " type": i[" type"],
      " column": i[" column"],
      " order": i[" order"],
      " nulls": "last",
    } as const;

    if (newIndex[" order"] === undefined) {
      return {
        ...newIndex,
        asc: asc(newIndex),
        desc: desc(newIndex),
      };
    } else {
      return newIndex;
    }
  };
type ReferenceOptional<column extends BuilderReferenceColumn> =
  () => BuilderReferenceColumn<column[" scalar"], true, column[" reference"]>;

const referenceOptional =
  <column extends BuilderReferenceColumn>(
    col: column,
  ): ReferenceOptional<column> =>
  () => {
    return {
      " type": col[" type"],
      " scalar": col[" scalar"],
      " optional": true,
      " reference": col[" reference"],
    };
  };

type References<column extends BuilderScalarColumn> = <
  reference extends string,
>(
  ref: reference,
) => BuilderReferenceColumn<column[" scalar"], column[" optional"], reference>;

const references =
  <column extends BuilderScalarColumn>(col: column): References<column> =>
  // @ts-expect-error
  <reference extends string>(ref: reference) => {
    const newCol = {
      " type": "reference",
      " scalar": col[" scalar"],
      " optional": col[" optional"],
      " reference": ref,
    } as const;

    if (newCol[" optional"]) {
      return newCol;
    } else {
      return { ...newCol, optional: referenceOptional(newCol) };
    }
  };

type JSONOptional<column extends BuilderJSONColumn> = () => BuilderJSONColumn<
  column[" json"],
  true
>;

const jsonOptional =
  <column extends BuilderJSONColumn>(col: column): JSONOptional<column> =>
  () => {
    return {
      " type": "json",
      " json": {} as (typeof col)[" json"],
      " optional": true,
    };
  };

const scalarColumn =
  <scalar extends Scalar>(_scalar: scalar) =>
  (): Prettify<BuilderScalarColumn<scalar, false, false>> => {
    const column = {
      " type": "scalar",
      " scalar": _scalar,
      " optional": false,
      " list": false,
    } as const;

    return {
      ...column,
      optional: optional(column),
      list: list(column),
      references: references(column),
    };
  };

export type BuilderScalarColumn<
  scalar extends Scalar = Scalar,
  optional extends boolean = boolean,
  list extends boolean = boolean,
  ///
  base extends ScalarColumn<scalar, optional, list> = ScalarColumn<
    scalar,
    optional,
    list
  >,
> = list extends false
  ? optional extends false
    ? base & {
        /**
         * Mark the column as optional.
         *
         * - Docs: https://ponder.sh/docs/schema#optional
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   t: p.createTable({
         *     id: p.string(),
         *     o: p.int().optional(),
         *   })
         * }));
         */
        optional: Optional<base>;
        /**
         * Mark the column as a list.
         *
         * - Docs: https://ponder.sh/docs/schema#list
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   t: p.createTable({
         *     id: p.string(),
         *     l: p.int().list(),
         *   })
         * }));
         */
        list: List<base>;
        references: References<base>;
      }
    : base & {
        /**
         * Mark the column as a list.
         *
         * - Docs: https://ponder.sh/docs/schema#list
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   t: p.createTable({
         *     id: p.string(),
         *     l: p.int().list(),
         *   })
         * }))
         */
        list: List<base>;
        /**
         * Mark the column as a foreign key.
         *
         * - Docs: https://ponder.sh/docs/schema#foreign-key
         *
         * @param references Table that this column is a key of.
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   a: p.createTable({
         *     id: p.string(),
         *     b_id: p.string.references("b.id"),
         *   })
         *   b: p.createTable({
         *     id: p.string(),
         *   })
         * }));
         */
        references: References<base>;
      }
  : optional extends false
    ? base & {
        /**
         * Mark the column as optional.
         *
         * - Docs: https://ponder.sh/docs/schema#optional
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   t: p.createTable({
         *     id: p.string(),
         *     o: p.int().optional(),
         *   })
         * }));
         */
        optional: Optional<base>;
      }
    : base;

export type BuilderReferenceColumn<
  scalar extends Scalar = Scalar,
  optional extends boolean = boolean,
  reference extends string = string,
  ///
  base extends ReferenceColumn<scalar, optional, reference> = ReferenceColumn<
    scalar,
    optional,
    reference
  >,
> = optional extends false
  ? base & {
      /**
       * Mark the column as optional.
       *
       * - Docs: https://ponder.sh/docs/schema#optional
       *
       * @example
       * import { createSchema } from "@ponder/core";
       *
       * export default createSchema((p) => ({
       *   t: p.createTable({
       *     id: p.string(),
       *     o: p.int().optional(),
       *   })
       * })
       */
      optional: ReferenceOptional<base>;
    }
  : base;

export type BuilderJSONColumn<
  type = any,
  optional extends boolean = boolean,
  ///
  base extends JSONColumn<type, optional> = JSONColumn<type, optional>,
> = optional extends false
  ? base & {
      /**
       * Mark the column as optional.
       *
       * - Docs: https://ponder.sh/docs/schema#optional
       *
       * @example
       * import { createSchema } from "@ponder/core";
       *
       * export default createSchema((p) => ({
       *   t: p.createTable({
       *     id: p.string(),
       *     o: p.json().optional(),
       *   })
       * }));
       */
      optional: JSONOptional<base>;
    }
  : base;

export type BuilderOneColumn<reference extends string = string> = {
  " type": "one";
  " reference": reference;
};

export type BuilderManyColumn<
  referenceTable extends string = string,
  referenceColumn extends string = string,
> = {
  " type": "many";
  " referenceTable": referenceTable;
  " referenceColumn": referenceColumn;
};

export type BuilderEnumColumn<
  _enum extends string = string,
  optional extends boolean = boolean,
  list extends boolean = boolean,
  ///
  base extends EnumColumn<_enum, optional, list> = EnumColumn<
    _enum,
    optional,
    list
  >,
> = list extends false
  ? optional extends false
    ? base & {
        /**
         * Mark the column as optional.
         *
         * - Docs: https://ponder.sh/docs/schema#optional
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   e: p.createEnum(["ONE", "TWO"])
         *   t: p.createTable({
         *     id: p.string(),
         *     a: p.enum("e").optional(),
         *   })
         * }));
         */
        optional: EnumOptional<base>;
        /**
         * Mark the column as a list.
         *
         * - Docs: https://ponder.sh/docs/schema#list
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   e: p.createEnum(["ONE", "TWO"])
         *   t: p.createTable({
         *     id: p.string(),
         *     a: p.enum("e").list(),
         *   })
         * }));
         */
        list: EnumList<base>;
      }
    : base & {
        /**
         * Mark the column as a list.
         *
         * - Docs: https://ponder.sh/docs/schema#list
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   e: p.createEnum(["ONE", "TWO"])
         *   t: p.createTable({
         *     id: p.string(),
         *     a: p.enum("e").list(),
         *   })
         * }));
         */
        list: EnumList<base>;
      }
  : optional extends false
    ? base & {
        /**
         * Mark the column as optional.
         *
         * - Docs: https://ponder.sh/docs/schema#optional
         *
         * @example
         * import { createSchema } from "@ponder/core";
         *
         * export default createSchema((p) => ({
         *   e: p.createEnum(["ONE", "TWO"])
         *   t: p.createTable({
         *     id: p.string(),
         *     a: p.enum("e").optional(),
         *   })
         * }));
         */
        optional: EnumOptional<base>;
      }
    : base;

export type BuilderIndex<
  column extends string | readonly string[] = string | readonly string[],
  order extends "asc" | "desc" | undefined = "asc" | "desc" | undefined,
  nulls extends "first" | "last" | undefined = "first" | "last" | undefined,
  ///
  base extends Index<column, order, nulls> = Index<column, order, nulls>,
  isSingleColumn = column extends readonly string[] ? false : true,
> = order extends undefined
  ? nulls extends undefined
    ? isSingleColumn extends true
      ? base & {
          asc: Asc<base>;
          desc: Desc<base>;
          nullsFirst: NullsFirst<base>;
          nullsLast: NullsLast<base>;
        }
      : base
    : isSingleColumn extends true
      ? base & {
          asc: Asc<base>;
          desc: Desc<base>;
        }
      : base
  : nulls extends undefined
    ? isSingleColumn extends true
      ? base & {
          nullsFirst: NullsFirst<base>;
          nullsLast: NullsLast<base>;
        }
      : base
    : base;

export const string = scalarColumn("string");
export const int = scalarColumn("int");
export const float = scalarColumn("float");
export const boolean = scalarColumn("boolean");
export const hex = scalarColumn("hex");
export const bigint = scalarColumn("bigint");

export const json = <type = any>(): BuilderJSONColumn<type, false> => {
  const column = {
    " type": "json",
    " json": {} as type,
    " optional": false,
  } as const;

  return {
    ...column,
    optional: jsonOptional(column),
  };
};

export const one = <reference extends string>(
  ref: reference,
): BuilderOneColumn<reference> => ({
  " type": "one",
  " reference": ref,
});

export const many = <
  referenceTable extends string = string,
  referenceColumn extends string = string,
>(
  ref: `${referenceTable}.${referenceColumn}`,
): BuilderManyColumn<referenceTable, referenceColumn> => ({
  " type": "many",
  " referenceTable": ref.split(".")[0] as referenceTable,
  " referenceColumn": ref.split(".")[1] as referenceColumn,
});

export const _enum = <_enum extends string>(
  __enum: _enum,
): Prettify<BuilderEnumColumn<_enum, false, false>> => {
  const column = {
    " type": "enum",
    " enum": __enum,
    " optional": false,
    " list": false,
  } as const;

  return {
    ...column,
    optional: enumOptional(column),
    list: enumList(column),
  };
};

export const index = <const column extends string | readonly string[]>(
  c: column,
): BuilderIndex<column, undefined, undefined> => {
  const index = {
    " type": "index",
    " column": c,
    " order": undefined,
    " nulls": undefined,
  } as const;

  return {
    ...index,
    asc: asc(index),
    desc: desc(index),
    nullsFirst: nullsFirst(index),
    nullsLast: nullsLast(index),
  } as BuilderIndex<column, undefined, undefined>;
};
