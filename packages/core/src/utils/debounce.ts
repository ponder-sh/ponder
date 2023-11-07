type Fn<TA extends any[] = any[], TR = any> = (...args: TA) => TR;

/**
 * Creates a debounced function that delays invoking `fun` until `ms` milliseconds
 * have passed since the last invocation of the debounced function.
 *
 * `fun` is invoked with the last arguments passed to the debounced function.
 *
 * Derived from `froebel/debounce`.
 * https://github.com/MathisBullinger/froebel/blob/main/debounce.ts
 */
export function debounce<T extends Fn>(ms: number, fun: T) {
  let toId: any;
  return (...args: Parameters<T>) => {
    clearTimeout(toId);
    toId = setTimeout(() => fun(...args), ms);
  };
}
