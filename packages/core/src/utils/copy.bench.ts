import { bench, group, run } from "mitata";
import { copy } from "./copy.js";

const obj = { a: 1, b: 2n, c: { d: 3 }, e: "hello" };

group("copy", () => {
  // 48.55 ns/iter
  bench("copy", () => {
    copy({ a: 1, b: 2 });
  }).gc("inner");
  // 540.76 ns/iter
  bench("structuredClone", () => {
    structuredClone(obj);
  }).gc("inner");
});

run();
