import { Slot } from "@radix-ui/react-slot";
import Link from "next/link";

import { buttonDefaults } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import GraphLogo from "../public/graph.svg";
import {
  CommandLineIcon,
  CursorArrowRaysIcon,
  ServerStackIcon,
  ShieldCheckIcon,
} from "./icons";

export function Home() {
  return (
    <main className="w-full max-w-full relative">
      <div className="max-w-[1180px] mx-auto px-6 mt-4 md:mt-16">
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
                <Slot
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "flex-grow md:px-10 text-neutral-50 bg-ponder hover:bg-ponder-200/90",
                  ])}
                >
                  <Link href="/docs/getting-started">Get started</Link>
                </Slot>
                <Slot
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "text-neutral-900 dark:text-neutral-50 bg-white bg-opacity-20 hover:bg-opacity-30",
                  ])}
                >
                  <Link href="/blog/introducing-ponder">Why Ponder?</Link>
                </Slot>
              </div>
              <div className="flex flex-row justify-center">
                <Slot
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "flex-grow border text-neutral-900 dark:text-neutral-50 border-neutral-200/30 hover:bg-neutral-100/30",
                  ])}
                >
                  <Link
                    href="https://github.com/0xOlias/ponder"
                    target="_blank"
                  >
                    View on GitHub
                  </Link>
                </Slot>
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
                Sync <strong>~10x faster</strong> than Graph Protocol subgraphs
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

        <Card className="w-full flex flex-col justify-between md:flex-row gap-8 mb-8">
          <div className="flex flex-col lg:flex-row w-full">
            <div className="flex flex-col flex-grow lg:border-r border-neutral-200 dark:border-neutral-50/20">
              <div className="flex flex-col px-4 md:px-8 pt-6 md:pt-8">
                <CardTitle className="mb-6">Benchmarks</CardTitle>
                <div className="flex flex-row justify-start mb-3 gap-3 w-full">
                  <div className="h-[33px] w-[calc((100%-68px)/10.8)] bg-ponder rounded-[4px]" />
                  <p className="pt-[2px]">31s</p>
                </div>
                <div className="flex flex-row justify-start mb-5 gap-3 w-full">
                  <div className="h-[34px] w-[calc(100%-68px)] bg-neutral-400 dark:bg-neutral-700 rounded-[4px] flex items-center">
                    <GraphLogo className="ml-[10px]" />
                  </div>
                  <p className="pt-[2px]">5m 28s</p>
                </div>
              </div>

              <div className="grid grid-cols-5">
                <div className="col-span-1 py-2 pl-4 md:pl-8 text-sm border-neutral-200 dark:border-neutral-50/20 border-b text-neutral-500">
                  Benchmark
                </div>
                <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
                  Sync (No Cache)
                </div>
                <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
                  Sync (Cache)
                </div>
                <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
                  Database Size
                </div>
                <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
                  RPC Credits
                </div>

                <div className="col-span-1 py-2 pl-4 md:pl-8 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
                  Ponder
                </div>
                <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
                  37s
                </div>
                <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
                  5s
                </div>
                <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
                  31 MB
                </div>
                <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b text-ponder bg-ponder/10">
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
                <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
                  1.1 GB
                </div>
                <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 max-lg:border-b">
                  167k
                </div>
              </div>
            </div>

            <div className="flex flex-col lg:max-w-[27ch] p-4 md:p-8">
              <p className="text-sm mb-4 text-neutral-200">
                Each benchmark indexed the Rocket Pool ERC20 token contract on
                mainnet from block 18,600,000 to 18,718,056 (latest) and ran on
                a M1 MacBook Pro with 8 cores and 16GB of RAM against an Alchemy
                node on the Growth plan using a 950MB/s network connection.
              </p>
              <Link
                href="https://github.com/0xOlias/ponder/tree/main/benchmarks#readme"
                target="_blank"
                className="text-sm text-ponder hover:text-ponder-50/90"
              >
                Try it yourself →
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
