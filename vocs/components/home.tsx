import {
  CommandLineIcon,
  CursorArrowRaysIcon,
  GraphLogo,
  ServerStackIcon,
  ShieldCheckIcon,
} from "./icons.js";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { cn } from "./utils.js";

const buttonDefaults =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-neutral-950 dark:focus-visible:ring-neutral-300";

export function Home() {
  return (
    <main className="w-full max-w-full relative">
      <div className="max-w-[1180px] mx-auto md:mt-6">
        <div className="w-full flex flex-col justify-between md:flex-row gap-8 p-4 mb-6 md:p-8 rounded-lg text-neutral-950 shadow-sm dark:text-neutral-50 hero-texture">
          <div className="flex flex-col items-start space-y-1.5 max-w-[540px]">
            <p className="pb-4 text-neutral-500 dark:text-neutral-400">
              Introducing Ponder
            </p>
            <h1 className="text-4xl font-semibold tracking-tight pb-4">
              Rapidly build an API for any EVM smart contract
            </h1>
            <p>
              Ponder is an open-source backend framework for building robust,
              performant, and maintainable crypto apps
            </p>
          </div>

          <div className="flex flex-row justify-center items-end w-full md:w-[unset]">
            <div className="w-full md:w-[unset] space-y-4">
              <div className="flex flex-row gap-4">
                <a
                  href="/docs/get-started"
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "flex-grow md:px-10 text-neutral-50 bg-ponder-400 hover:bg-ponder-200/90",
                    "inline-flex items-center justify-center",
                  ])}
                >
                  Get started
                </a>
                <a
                  href="/docs/why-ponder"
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "text-neutral-900 dark:text-neutral-50 bg-white/20 hover:bg-white/30",
                    "inline-flex items-center justify-center",
                  ])}
                >
                  Why Ponder?
                </a>
              </div>
              <div className="flex flex-row justify-center">
                <a
                  href="https://github.com/ponder-sh/ponder"
                  target="_blank"
                  rel="noreferrer"
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "flex-grow border text-neutral-900 dark:text-neutral-50 border-neutral-200/30 hover:bg-neutral-100/30",
                    "inline-flex items-center justify-center",
                  ])}
                >
                  View on GitHub
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between flex-wrap gap-y-4 mb-6">
          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <ServerStackIcon />
              </div>
              <CardTitle>Powerful local dev server</CardTitle>
              <CardDescription>
                Build incredibly fast & stay unblocked with{" "}
                <strong>hot reloading</strong>
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <ShieldCheckIcon />
              </div>
              <CardTitle>Fast & lean</CardTitle>
              <CardDescription>
                Ponder indexes <strong>~10x faster</strong> than Graph Protocol
                subgraphs
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <CommandLineIcon />
              </div>
              <CardTitle>Type safe</CardTitle>
              <CardDescription>
                End-to-end type safety & autocomplete with{" "}
                <strong>no codegen</strong>
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <CursorArrowRaysIcon />
              </div>
              <CardTitle>One-click deploys</CardTitle>
              <CardDescription>
                Deploy anywhere that runs Node.js with{" "}
                <strong>zero downtime</strong> &{" "}
                <strong>horizontal scaling</strong>
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Benchmarks />
      </div>

      <div className="h-12" />
    </main>
  );
}

function Benchmarks({
  className,
  flat,
}: { className?: string; flat?: boolean }) {
  return (
    <Card
      className={cn([
        "w-full flex flex-col justify-between md:flex-row gap-8 mb-8",
        flat ? "rounded-none md:rounded-lg" : "",
        className,
      ])}
    >
      <div className="flex flex-col lg:flex-row w-full">
        <div className="flex flex-col flex-grow lg:border-r border-neutral-200 dark:border-neutral-50/20">
          <div className="flex flex-col px-4 md:px-8 pt-6 md:pt-8">
            <CardTitle className="mb-6">Benchmarks</CardTitle>
            <div className="flex flex-row justify-start mb-3 gap-3 w-full">
              <div className="h-[33px] w-[calc((100%-75px)*0.0925)] bg-ponder-400 rounded-[4px]" />
              <p className="pt-[2px]">37s</p>
            </div>
            <div className="flex flex-row justify-start mb-5 gap-3 w-full">
              <div className="h-[34px] w-[calc(100%-75px)] bg-neutral-400 dark:bg-neutral-700 rounded-[4px] flex items-center">
                <GraphLogo className="ml-[10px]" />
              </div>
              <p className="pt-[2px]">6m 40s</p>
            </div>
          </div>

          <div className="grid grid-cols-4 md:grid-cols-5">
            <div className="col-span-1 py-2 pl-4 md:pl-8 text-sm border-neutral-200 dark:border-neutral-50/20 border-b text-neutral-500" />
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
              Sync (Cold)
            </div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
              Sync (Cache)
            </div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b hidden md:block">
              Database Size
            </div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
              RPC Credits
            </div>

            <div className="col-span-1 py-2 pl-4 md:pl-8 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder-400 bg-ponder/10">
              Ponder
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder-400 bg-ponder/10">
              37s
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder-400 bg-ponder/10">
              5s
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder-400 bg-ponder/10 hidden md:block">
              31 MB
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b text-ponder-400 bg-ponder/10">
              108k
            </div>

            <div className="col-span-1 py-2 pl-4 pb-3 lg:pb-6 md:pl-8 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
              The Graph
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
              5m 28s
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
              1m 15s
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b hidden md:block">
              1.1 GB
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 max-lg:border-b">
              167k
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:max-w-[22ch] p-4 md:p-6">
          <p className="text-sm mb-4 text-neutral-700 dark:text-neutral-200">
            Results of indexing the Rocket Pool ERC20 token contract on mainnet
            from block 18,600,000 to 18,718,056 (latest) on an M1 MacBook Pro (8
            core, 16GB RAM) against an Alchemy node on the Growth plan using a
            950MB/s network connection.
          </p>
          <a
            href="https://github.com/ponder-sh/ponder/tree/main/benchmarks#readme"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ponder-400 hover:text-ponder-50/90"
          >
            Run it yourself →
          </a>
        </div>
      </div>
    </Card>
  );
}
