import { type Extend, extend } from "@/utils/extend.js";
import { create, kill, start } from "./service.js";
import type { RealtimeSyncEvent, Service } from "./service.js";

const methods = {
  start,
  kill,
};

export const createRealtimeSyncService = extend(create, methods);

export type RealtimeSyncService = Extend<Service, typeof methods>;

export type { RealtimeSyncEvent };
