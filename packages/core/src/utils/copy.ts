import util from "node:util";

/**
 * Symbol used to mark objects that are copied on write.
 */
export const COPY_ON_WRITE = Symbol.for("ponder:copyOnWrite");

/**
 * Target of a copy-on-write proxy.
 *
 * Note: The handler is shared by all proxies, so the state of each proxy
 * is stored in its target.
 */
class CopyOnWriteTarget {
  obj: object;
  copiedObject: object | undefined;

  constructor(obj: object) {
    this.obj = obj;
    this.copiedObject = undefined;
  }

  // Note: `this` is the proxy when called by `util.inspect`.
  [util.inspect.custom]() {
    // @ts-expect-error
    return this[COPY_ON_WRITE] ?? this.copiedObject ?? this.obj;
  }
}

const getCopiedObject = (target: CopyOnWriteTarget) => {
  if (target.copiedObject === undefined) {
    target.copiedObject = structuredClone(target.obj);
  }
  return target.copiedObject;
};

const copyOnWriteHandler: ProxyHandler<CopyOnWriteTarget> = {
  get(target, prop, receiver) {
    if (prop === COPY_ON_WRITE) {
      return target.copiedObject ?? target.obj;
    }
    let result = Reflect.get(target.copiedObject ?? target.obj, prop, receiver);

    if (
      typeof result === "object" &&
      result !== null &&
      target.copiedObject === undefined
    ) {
      result = Reflect.get(getCopiedObject(target), prop, receiver);
    }

    return result;
  },
  set(target, prop, newValue, receiver) {
    return Reflect.set(getCopiedObject(target), prop, newValue, receiver);
  },
  deleteProperty(target, prop) {
    return Reflect.deleteProperty(getCopiedObject(target), prop);
  },
  defineProperty(target, prop, descriptor) {
    return Reflect.defineProperty(getCopiedObject(target), prop, descriptor);
  },
  ownKeys(target) {
    return Reflect.ownKeys(target.copiedObject ?? target.obj);
  },
  has(target, prop) {
    return Reflect.has(target.copiedObject ?? target.obj, prop);
  },
  getOwnPropertyDescriptor(target, prop) {
    return Reflect.getOwnPropertyDescriptor(
      target.copiedObject ?? target.obj,
      prop,
    );
  },
  getPrototypeOf(target) {
    return Reflect.getPrototypeOf(target.copiedObject ?? target.obj);
  },
};

/**
 * Create a copy-on-write proxy for a plain object.
 *
 * @dev Arrays and other exotic objects are not supported. The proxy target
 * is a `CopyOnWriteTarget`, not `obj`, so the proxy invariants break for
 * non-configurable properties such as `Array.length`:
 * `Object.keys()` and spread throw a `TypeError`, and `Array.isArray()`
 * returns `false`.
 */
export const copyOnWrite = <T extends { [key: string]: unknown }>(
  obj: T,
): T => {
  return new Proxy(
    new CopyOnWriteTarget(obj),
    copyOnWriteHandler,
  ) as unknown as T;
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
  const underlying = obj[COPY_ON_WRITE];
  if (underlying !== undefined) return copy(underlying, fast);

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
