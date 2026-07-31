import util from "node:util";

/**
 * Symbol used to mark objects that are copied on write.
 */
export const COPY_ON_WRITE = Symbol.for("ponder:copyOnWrite");

const copyOnWriteCopies = new WeakMap<object, object>();

function inspectCopyOnWrite(this: object) {
  return copyOnWriteCopies.get(this) ?? (this as any)[COPY_ON_WRITE] ?? this;
}

/**
 * Create a copy-on-write proxy for an object.
 */
export const copyOnWrite = <T extends object>(obj: T): T => {
  let copiedObject: T | undefined;

  Object.defineProperty(obj, util.inspect.custom, {
    value: inspectCopyOnWrite,
    configurable: true,
  });

  const proxy = new Proxy<T>(obj, {
    get(target, prop, receiver) {
      if (prop === COPY_ON_WRITE) {
        return target;
      }
      let result = Reflect.get(copiedObject ?? target, prop, receiver);

      if (
        typeof result === "object" &&
        result !== null &&
        copiedObject === undefined
      ) {
        copiedObject = structuredClone(target);
        copyOnWriteCopies.set(proxy, copiedObject);
        result = Reflect.get(copiedObject, prop, receiver);
      }

      return result;
    },
    set(target, prop, newValue, receiver) {
      if (copiedObject === undefined) {
        copiedObject = structuredClone(target);
        copyOnWriteCopies.set(proxy, copiedObject);
      }
      return Reflect.set(copiedObject, prop, newValue, receiver);
    },
    deleteProperty(target, prop) {
      if (copiedObject === undefined) {
        copiedObject = structuredClone(target);
        copyOnWriteCopies.set(proxy, copiedObject);
      }
      return Reflect.deleteProperty(copiedObject, prop);
    },
    defineProperty(target, prop, descriptor) {
      if (copiedObject === undefined) {
        copiedObject = structuredClone(target);
        copyOnWriteCopies.set(proxy, copiedObject);
      }
      return Reflect.defineProperty(copiedObject, prop, descriptor);
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

  return proxy;
};

/**
 * Create a deep copy of an object.
 *
 * @dev This function supports copying objects that
 * have been created with `copyOnWrite`.
 */
export const copy = <T>(obj: T, fast: boolean): T => {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  // @ts-expect-error
  const proxy = obj[COPY_ON_WRITE];
  if (proxy !== undefined) return proxy;

  if (fast) {
    // Note: spread operator is significantly faster than `structuredClone`
    return (Array.isArray(obj) ? [...obj] : { ...obj }) as T;
  }

  if (Array.isArray(obj)) {
    if (hasProxy(obj)) {
      // @ts-expect-error
      return obj.map((element) => copy(element));
    }

    if (isDeeplyNested(obj)) return structuredClone(obj);
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

  if (isDeeplyNested(obj)) return structuredClone(obj);
  return { ...obj };
};

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

const isDeeplyNested = (obj: any, depth = 0): boolean => {
  if (obj === null || typeof obj !== "object") {
    return false;
  }

  if (depth > 0) {
    return true;
  }

  if (Array.isArray(obj)) {
    return obj.some((element) => isDeeplyNested(element, depth + 1));
  }

  for (const value of Object.values(obj)) {
    if (isDeeplyNested(value, depth + 1)) {
      return true;
    }
  }

  return false;
};
