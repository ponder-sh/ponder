/**
 * @description Combines members of an intersection into a readable type.
 *
 * @link https://twitter.com/mattpocockuk/status/1622730173446557697?s=20&t=NdpAcmEFXY01xkqU3KO0Mg
 * @example
 * Prettify<{ a: string } | { b: string } | { c: number, d: bigint }>
 * => { a: string, b: string, c: number, d: bigint }
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

/**
 * @description Creates a type with required and non-null keys K from T.
 *
 * @example
 * type Result = RequiredBy<{ a?: string, b: number | null, c: number }, 'a' | 'b'>
 * //   ^? { a: string, b: number, c: number }
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & {
  [P in keyof Pick<T, K>]: NonNullable<T[P]>;
};

/**
 * @description Creates a type with all keys K from T as non-null.
 */
export type NonNull<T> = {
  [P in keyof T]-?: NonNullable<T[P]>;
};

/**
 * @description Returns true if T only has a property named "id".
 */
export type HasOnlyIdProperty<T> = Exclude<keyof T, "id"> extends never
  ? true
  : false;

/**
 * @description Creates a union of the names of all the required properties of T.
 */
type RequiredPropertyNames<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

export type HasRequiredPropertiesOtherThanId<T> = Exclude<
  RequiredPropertyNames<T>,
  "id"
> extends never
  ? false
  : true;
