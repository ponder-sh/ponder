import { Benchmarks } from "./benchmarks.js";
import { Footer } from "./footer.js";
import {
  CommandLineIcon,
  CursorArrowRaysIcon,
  ServerStackIcon,
  ShieldCheckIcon,
} from "./icons.js";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { cn } from "./utils.js";

const buttonDefaults =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-neutral-950 dark:focus-visible:ring-neutral-300";

export function Home() {
  return (
    <>
      <main className="w-full max-w-full relative">
        <div className="max-w-[1180px] mx-auto md:mt-4">
          <div className="w-full flex flex-col justify-between md:flex-row gap-8 p-4 mb-6 md:p-8 rounded-lg hero-texture">
            <div className="flex flex-col items-start space-y-1.5 max-w-[540px] text-neutral-950 dark:text-neutral-50">
              <div className="h-5"/>
              <h1 className="text-4xl font-semibold tracking-tight pb-4">
                Rapid custom indexing for any EVM smart contract
              </h1>
              <p>
                Ponder is an open-source framework for building fast, reliable,
                <br className="hidden lg:inline" />
                and maintainable backend software in crypto.
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
                <CardTitle>Powerful local development server</CardTitle>
                <CardDescription>
                  Build faster & stay unblocked with{" "}
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
                  Ponder indexes <strong>~10x faster</strong> than Graph
                  Protocol subgraphs
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
      </main>

      <Footer />
    </>
  );
}
