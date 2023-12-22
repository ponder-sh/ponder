import { TASK_TIMEOUT } from "./queue.js";

export const getErrorMessage = (error: Error) =>
  error.name === "TimeoutError"
    ? `Timed out after ${TASK_TIMEOUT} ms`
    : `${error.name}: ${error.message}`;
