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
