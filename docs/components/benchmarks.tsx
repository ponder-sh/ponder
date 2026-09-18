import { Card, CardTitle } from "./ui/card.js";
import { cn } from "./utils.js";

const currentBenchmark = [
  { name: "Ponder", version: "0.17.10", seconds: 32.5, label: "32.5s" },
  { name: "TheGraph", version: "0.45.0", seconds: 3330, label: "3330s" },
];

const versionHistory = [
  ["0.17.10", 32.5, "2026-09-08"],
  ["0.16.10", 36.6, "2026-07-13"],
  ["0.15.18", 36.1, "2026-01-05"],
  ["0.14.13", 38.5, "2025-11-05"],
  ["0.13.14", 44.5, "2025-10-13"],
  ["0.12.26", 57.6, "2025-09-18"],
  ["0.11.43", 75.3, "2025-07-31"],
  ["0.10.27", 76.5, "2025-05-15"],
  ["0.9.28", 135, "2025-03-12"],
  ["0.8.33", 252, "2025-01-27"],
  ["0.7.17", 250, "2024-12-09"],
  ["0.6.26", 123, "2024-12-05"],
  ["0.5.25", 123, "2024-12-05"],
  ["0.4.43", 146, "2024-07-17"],
] as const;

function BenchmarkRows({
  rows,
  position,
  showDate = false,
}: {
  rows: readonly {
    name: string;
    version: string;
    seconds: number;
    label: string;
    date?: string;
  }[];
  position: (seconds: number) => number;
  showDate?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const isCurrent = row.version === "0.17.10";
        const left = position(row.seconds);
        const isNearRight = left > 76;

        return (
          <div
            className="flex min-w-0 items-center gap-3 font-mono text-xs"
            key={`${row.name}-${row.version}`}
          >
            <div className="flex w-[92px] shrink-0 items-baseline gap-1.5 font-sans">
              <span
                className={cn(
                  "whitespace-nowrap",
                  isCurrent ? "font-bold text-neutral-900" : "text-neutral-600",
                )}
              >
                {row.name}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[10px]",
                  isCurrent
                    ? "font-semibold text-ponder-400"
                    : "text-neutral-500",
                )}
              >
                {row.version}
              </span>
            </div>
            <div className="relative h-6 min-w-0 flex-1 bg-neutral-100 dark:bg-neutral-800">
              <div
                className={cn(
                  "absolute inset-y-0 left-0",
                  isCurrent
                    ? "bg-ponder-400"
                    : "bg-neutral-400 dark:bg-neutral-600",
                )}
                style={{ width: `${left}%` }}
              />
              {showDate && row.date ? (
                <span
                  className={cn(
                    "absolute inset-y-0 flex items-center whitespace-nowrap text-[10px]",
                    isNearRight ? "right-2 text-white" : "text-neutral-500",
                  )}
                  style={
                    isNearRight
                      ? undefined
                      : { left: `calc(${left}% + 0.5rem)` }
                  }
                >
                  {row.date}
                </span>
              ) : isCurrent ? (
                <span
                  className="absolute inset-y-0 flex items-center whitespace-nowrap pl-2 text-ponder-400"
                  style={{ left: `${left}%` }}
                >
                  101.5× faster than TheGraph
                </span>
              ) : null}
            </div>
            <span
              className={cn(
                "w-14 shrink-0 text-right",
                isCurrent
                  ? "text-base font-semibold text-neutral-900"
                  : "text-neutral-500",
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

function Axis({ labels }: { labels: string[] }) {
  return (
    <div className="ml-[104px] mr-14 mt-3 flex justify-between border-t border-neutral-900 pt-1 font-mono text-[10px] text-neutral-500">
      {labels.map((label) => (
        <span key={label}>{label}</span>
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
  const brokenPosition = (seconds: number) =>
    seconds <= 260 ? (seconds / 260) * 74 : 80 + ((seconds - 3200) / 200) * 20;

  const currentRows = currentBenchmark.map((row) => ({ ...row }));
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
        "mb-8 w-full overflow-hidden bg-[#efefec] dark:bg-neutral-950",
        flat ? "rounded-none md:rounded-lg" : "",
        className,
      )}
    >
      <div className="bg-white p-5 dark:bg-neutral-900 md:p-8">
        <CardTitle className="mb-8">Benchmarks</CardTitle>

        <div className="flex flex-col gap-8">
          <section>
            <h3 className="mb-4 text-sm font-semibold">Ponder vs. TheGraph</h3>

            <BenchmarkRows rows={currentRows} position={brokenPosition} />
            <Axis
              labels={["0s", "50s", "100s", "150s", "200s", "250s", "3.3ks"]}
            />
          </section>

          <section>
            <h3 className="mb-4 text-sm font-semibold">
              Ponder performance over time
            </h3>

            <BenchmarkRows
              rows={historyRows}
              position={(seconds) => (seconds / 340) * 100}
              showDate
            />
            <Axis
              labels={["0s", "50s", "100s", "150s", "200s", "250s", "300s"]}
            />
          </section>
        </div>

        <div className="mt-8 mb-3 w-full border-t border-neutral-300 dark:border-neutral-700" />
        <p className="w-full text-xs leading-5 text-neutral-600 dark:text-neutral-300">
          The benchmark indexes Rocket Pool ETH from Ethereum block 13,325,304
          to 25,900,000. It resulted in 1,378,535 indexed events. All chain data
          for Ponder and TheGraph was cached.{" "}
          <a
            className="text-ponder-400 underline underline-offset-2 hover:text-ponder-50/90"
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
