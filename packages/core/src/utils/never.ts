export const never = (_x: never) => {
  throw new Error("Unreachable");
};
