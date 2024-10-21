export const uncapitalize = <T extends string>(input: T) =>
  (input.length
    ? `${input[0]!.toLocaleLowerCase()}${input.length > 1 ? input.slice(1, input.length) : ""}`
    : input) as Uncapitalize<T>;

export const capitalize = <T extends string>(input: T) =>
  (input.length
    ? `${input[0]!.toLocaleUpperCase()}${input.length > 1 ? input.slice(1, input.length) : ""}`
    : input) as Capitalize<T>;
