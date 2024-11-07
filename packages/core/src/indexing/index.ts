import { type Extend, extend } from "@/utils/extend.js";
import {
  create,
  kill,
  processEvents,
  processSetupEvents,
  setIndexingStore,
  updateTotalSeconds,
} from "./service.js";
import type { Context, Service } from "./service.js";

const methods = {
  create,
  kill,
  processEvents,
  processSetupEvents,
  updateTotalSeconds,
  setIndexingStore,
};

export const createIndexingService = extend(create, methods);

export type IndexingService = Extend<Service, typeof methods>;

export type { Context };
