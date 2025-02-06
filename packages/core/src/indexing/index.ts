import { type Extend, extend } from "@/utils/extend.js";
import {
  create,
  processEvents,
  processSetupEvents,
  setIndexingStore,
} from "./service.js";
import type { Context, Service } from "./service.js";

const methods = {
  create,
  processEvents,
  processSetupEvents,
  setIndexingStore,
};

export const createIndexingService = extend(create, methods);

export type IndexingService = Extend<Service, typeof methods>;

export type { Context };
