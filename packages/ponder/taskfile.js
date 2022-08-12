import { bar as baz, foo } from "./bat";

export default async function (task) {
  await task.source("src/*.js");
}
