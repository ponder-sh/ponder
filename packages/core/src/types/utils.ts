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
 * @description Creates a type with all keys K from T as non-null.
 */
export type NonNull<T> = {
  [P in keyof T]-?: NonNullable<T[P]>;
};

export type PonderTypeError<error extends string> = error;
