import { type Extend, extend } from "@/utils/extend.js";
import { create, start } from "./service.js";
import type { RealtimeSyncEvent, Service } from "./service.js";

const methods = {
  start,
};

export const createRealtimeSyncService = extend(create, methods);

export type RealtimeSyncService = Extend<Service, typeof methods>;

export type { RealtimeSyncEvent };
