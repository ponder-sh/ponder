export const firstParam = (param: string | string[] | undefined) => {
  return Array.isArray(param) ? param[0] : param;
};
