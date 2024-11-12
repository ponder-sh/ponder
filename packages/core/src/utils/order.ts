export const orderObject = <T extends { [key: string]: any } | any[]>(
  obj: T,
): T => {
  if (Array.isArray(obj)) return obj.map((x) => orderObject(x)) as T;

  const newObj = {} as T;
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (typeof val === "object") {
      newObj[key as keyof T] = orderObject(obj[key]);
    } else {
      newObj[key as keyof T] = obj[key];
    }
  }

  return newObj;
};
