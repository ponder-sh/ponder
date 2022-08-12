export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const delayValue = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
