import { type Extend, extend } from "@/utils/extend.js";
import { create, kill, start } from "./service.js";
import type {
  Build,
  BuildResult,
  BuildService as _BuildService,
} from "./service.js";

const methods = {
  start,
  kill,
};

export const createBuildService = extend(create, methods);

export type BuildService = Extend<_BuildService, typeof methods>;

export type { BuildResult, Build };
