import { Card, CardTitle } from "./ui/card.js";
import { cn } from "./utils.js";

const currentBenchmark = [
  {
    name: "Ponder",
    version: "0.17.10",
    seconds: 32.5,
    label: "32.5s",
    callout: "102× faster",
  },
  { name: "The Graph", version: "0.45.0", seconds: 3330, label: "55m 30s" },
];

const versionHistory = [
  ["0.17.10", 32.5, "2026-09-08"],
  ["0.16.10", 36.6, "2026-07-13"],
  ["0.15.18", 36.1, "2026-01-05"],
  ["0.10.27", 76.5, "2025-05-15"],
  ["0.4.43", 146, "2024-07-17"],
] as const;

function BenchmarkRows({
  rows,
  scaleMax,
}: {
  rows: readonly {
    name: string;
    version: string;
    seconds: number;
    label: string;
    /** Shown in the bar track on sm+ screens. */
    date?: string;
    callout?: string;
  }[];
  scaleMax: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const isCurrent = row.version === "0.17.10";
        const left = (row.seconds / scaleMax) * 100;
        const isNearRight = left > 76;

        return (
          <div
            className="flex min-w-0 items-center gap-3 text-xs tabular-nums"
            key={`${row.name}-${row.version}`}
          >
            <div className="flex w-[72px] shrink-0 flex-col leading-tight sm:w-[100px] sm:flex-row sm:items-baseline sm:gap-1.5">
              <span
                className={cn(
                  "whitespace-nowrap",
                  isCurrent
                    ? "font-semibold text-neutral-950 dark:text-neutral-50"
                    : "text-neutral-700 dark:text-neutral-400",
                )}
              >
                {row.name}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[11px]",
                  isCurrent
                    ? "font-medium text-ponder-400"
                    : "text-neutral-500",
                )}
              >
                {row.version}
              </span>
            </div>
            <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-800">
              <div
                className={cn(
                  "absolute inset-y-0 left-0",
                  isCurrent
                    ? "bg-ponder-400"
                    : "bg-neutral-300 dark:bg-neutral-600",
                )}
                style={{ width: `${left}%` }}
              />
              {row.date ? (
                <span
                  className={cn(
                    "absolute inset-y-0 flex items-center whitespace-nowrap text-[11px] text-neutral-500 max-sm:hidden",
                    isNearRight && "right-2",
                  )}
                  style={
                    isNearRight
                      ? undefined
                      : { left: `calc(${left}% + 0.5rem)` }
                  }
                >
                  {row.date}
                </span>
              ) : row.callout ? (
                <span
                  className="absolute inset-y-0 flex items-center whitespace-nowrap pl-2 font-medium text-ponder-400 max-sm:hidden"
                  style={{ left: `${left}%` }}
                >
                  {row.callout}
                </span>
              ) : null}
            </div>
            <span
              className={cn(
                "w-14 shrink-0 whitespace-nowrap text-right",
                isCurrent
                  ? "text-sm font-semibold text-neutral-950 dark:text-neutral-50"
                  : "text-neutral-700 dark:text-neutral-400",
              )}
            >
              {row.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Labels are spaced evenly from 0 to the chart's `scaleMax`. On small screens,
// every other label is hidden so the remaining ones don't collide. The left
// margin matches the row label column plus its gap.
function Axis({ labels }: { labels: string[] }) {
  return (
    <div className="ml-[84px] mr-[68px] sm:ml-[112px] mt-3 flex justify-between border-t border-neutral-200 pt-1 text-[11px] tabular-nums text-neutral-500 dark:border-neutral-800">
      {labels.map((label) => (
        <span className="max-sm:even:invisible" key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

export function Benchmarks({
  className,
  flat,
}: {
  className?: string;
  flat?: boolean;
}) {
  const historyRows = versionHistory.map(([version, seconds, date]) => ({
    name: "Ponder",
    version,
    seconds,
    label: `${seconds}s`,
    date,
  }));

  return (
    <Card
      className={cn(
        "mb-8 w-full overflow-hidden",
        flat ? "rounded-none md:rounded-lg" : "",
        className,
      )}
    >
      <div className="p-4 md:p-8">
        <CardTitle className="mb-8">Benchmarks</CardTitle>

        <div className="flex flex-col gap-8">
          <section>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h4 className="text-sm font-semibold">Ponder vs. The Graph</h4>
              <span className="text-xs font-medium text-ponder-400 sm:hidden">
                102× faster
              </span>
            </div>

            <BenchmarkRows rows={currentBenchmark} scaleMax={3600} />
            <Axis labels={["0m", "15m", "30m", "45m", "60m"]} />
          </section>

          <section>
            <h4 className="mb-4 text-sm font-semibold">
              Ponder performance over time
            </h4>

            <BenchmarkRows rows={historyRows} scaleMax={160} />
            <Axis labels={["0s", "40s", "80s", "120s", "160s"]} />
          </section>
        </div>

        <div className="mt-8 mb-3 w-full border-t border-neutral-200 dark:border-neutral-800" />
        <p className="w-full text-xs leading-5 text-neutral-700 dark:text-neutral-400">
          The benchmark indexes Rocket Pool ETH from Ethereum block 13,325,304
          to 25,900,000. It resulted in 1,378,535 indexed events. All chain data
          for Ponder and The Graph was cached.{" "}
          <a
            className="text-ponder-400 underline underline-offset-2 hover:text-ponder-500"
            href="https://github.com/ponder-sh/ponder/tree/main/benchmark"
          >
            Run the benchmark yourself
          </a>
          .
        </p>
      </div>
    </Card>
  );
}
