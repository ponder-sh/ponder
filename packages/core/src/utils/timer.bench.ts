import { bench, run } from "mitata";
import { startClock } from "./timer.js";

// 21.62 ns/iter
bench("startClock", () => {
  const clock = startClock();
  clock();
}).gc("inner");

run();
