import type { Prettify } from "@/types/utils.js";
import type {
  EnumColumn,
  Index,
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
        optional: Optional<base>;
        list: List<base>;
        references: References<base>;
      }
    : base & {
        list: List<base>;
        references: References<base>;
      }
  : optional extends false
    ? base & {
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
      optional: ReferenceOptional<base>;
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
        optional: EnumOptional<base>;
        list: EnumList<base>;
      }
    : base & {
        list: EnumList<base>;
      }
  : optional extends false
    ? base & {
        optional: EnumOptional<base>;
      }
    : base;

export const string = scalarColumn("string");
export const int = scalarColumn("int");
export const float = scalarColumn("float");
export const boolean = scalarColumn("boolean");
export const hex = scalarColumn("hex");
export const bigint = scalarColumn("bigint");

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
): Index<column> => {
  return {
    " type": "index",
    " column": c,
  };
};
