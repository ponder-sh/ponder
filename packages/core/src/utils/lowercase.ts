/**
 * Transforms the input string to lower case.
 */
export function toLowerCase<T extends string>(value: T) {
  return value.toLowerCase() as Lowercase<T>;
}
