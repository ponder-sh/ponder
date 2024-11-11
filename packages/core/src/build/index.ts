import { type Extend, extend } from "@/utils/extend.js";
import { create, kill, start } from "./service.js";
import type { ApiBuild, IndexingBuild, Service } from "./service.js";

const methods = { start, kill };

export const createBuildService = extend(create, methods);

export type BuildService = Extend<Service, typeof methods>;

export type { IndexingBuild, ApiBuild };
