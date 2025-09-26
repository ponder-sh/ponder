export const copyOnWrite = <T extends object>(obj: T): T => {
  const isArray = Array.isArray(obj);
  let copiedObject: T | undefined;
  const nestedProperties: (string | symbol)[] = [];

  return new Proxy<T>(obj, {
    get(target, prop, receiver) {
      const result = Reflect.get(copiedObject ?? target, prop, receiver);

      if (
        typeof result === "object" &&
        result !== null &&
        nestedProperties.includes(prop) === false
      ) {
        if (copiedObject === undefined) {
          // @ts-expect-error
          if (isArray) copiedObject = [...target];
          else copiedObject = { ...target };
        }
        nestedProperties.push(prop);

        const nestedProxy = copyOnWrite(result);
        // @ts-expect-error
        copiedObject[prop] = nestedProxy;
        return nestedProxy;
      }

      return result;
    },
    set(target, prop, newValue, receiver) {
      if (copiedObject === undefined) {
        // @ts-expect-error
        if (isArray) copiedObject = [...target];
        else copiedObject = { ...target };
      }
      return Reflect.set(copiedObject!, prop, newValue, receiver);
    },
    deleteProperty(target, prop) {
      if (copiedObject === undefined) {
        // @ts-expect-error
        if (isArray) copiedObject = [...target];
        else copiedObject = { ...target };
      }
      return Reflect.deleteProperty(copiedObject!, prop);
    },
    defineProperty(target, prop, descriptor) {
      if (copiedObject === undefined) {
        // @ts-expect-error
        if (isArray) copiedObject = [...target];
        else copiedObject = { ...target };
      }
      return Reflect.defineProperty(copiedObject!, prop, descriptor);
    },
    ownKeys(target) {
      return Reflect.ownKeys(copiedObject ?? target);
    },
    has(target, prop) {
      return Reflect.has(copiedObject ?? target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(copiedObject ?? target, prop);
    },
  });
};
