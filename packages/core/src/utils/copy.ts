export const COPY_ON_WRITE = Symbol.for("ponder:copyOnWrite");

/**
 * Create a copy-on-write proxy for an object.
 */
export const copyOnWrite = <T extends object>(obj: T): T => {
  const isArray = Array.isArray(obj);
  let copiedObject: T | undefined;
  const nestedProperties: (string | symbol)[] = [];

  return new Proxy<T>(obj, {
    get(target, prop, receiver) {
      if (prop === COPY_ON_WRITE) {
        return target;
      }
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

/**
 * Create a deep copy of an object.
 *
 * @dev This function supports copying objects that
 * have been created with `copyOnWrite`.
 */
export const copy = <T>(obj: T): T => {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  const hasProxy = (obj: any): boolean => {
    if (obj === null || typeof obj !== "object") {
      return false;
    }

    if (obj[COPY_ON_WRITE] !== undefined) {
      return true;
    }

    if (Array.isArray(obj)) {
      return obj.some((element) => hasProxy(element));
    }

    for (const value of Object.values(obj)) {
      if (hasProxy(value)) {
        return true;
      }
    }

    return false;
  };

  // @ts-expect-error
  const proxy = obj[COPY_ON_WRITE];
  if (proxy === undefined) {
    if (Array.isArray(obj)) {
      if (hasProxy(obj)) {
        // @ts-expect-error
        return obj.map((element) => copy(element));
      }

      return [...obj] as T;
    }

    if (hasProxy(obj)) {
      const result = {} as T;
      for (const [key, value] of Object.entries(obj)) {
        // @ts-expect-error
        result[key] = copy(value);
      }

      return result;
    }

    const copiedObject = Object.create(Object.getPrototypeOf(obj));
    Object.assign(copiedObject, obj);
    return copiedObject;
  }

  return proxy;
};
