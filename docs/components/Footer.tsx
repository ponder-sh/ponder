import Link from "next/link";
import { GitHubIcon } from "nextra/icons";

import PonderLogo from "../public/ponder.svg";
import { TelegramIcon, TwitterIcon } from "./icons";

export function Footer() {
  return (
    <div className="w-full text-sm">
      <div className="w-full flex flex-col">
        <div className="w-full flex flex-col justify-between gap-12 md:flex-row ">
          <div className="flex flex-row justify-between items-center md:flex-col md:items-start">
            <>
              <PonderLogo className="logo" />
              <span className="_sr-only">Ponder</span>
            </>

            <div className="flex flex-row gap-[10px]">
              <Link href="https://github.com/ponder-sh/ponder" target="_blank">
                <GitHubIcon className="text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors h-5" />
                <span className="_sr-only">GitHub</span>
              </Link>

              <div className="min-h-full w-[1px] bg-neutral-300 dark:bg-neutral-600" />

              <Link href="https://t.me/ponder_sh" target="_blank">
                <TelegramIcon className="text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors h-5" />
                <span className="_sr-only">Telegram</span>
              </Link>

              <div className="min-h-full w-[1px] bg-neutral-300 dark:bg-neutral-600" />

              <Link href="https://github.com/ponder-sh/ponder" target="_blank">
                <TwitterIcon className="text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors h-5 w-5" />
                <span className="_sr-only">Twitter</span>
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap md:flex-row gap-y-12">
            <div className="w-36 md:w-48 flex flex-col">
              <h4 className="mb-5 text-neutral-800 dark:text-neutral-100 font-semibold">
                Resources
              </h4>
              <Link
                href="/docs/getting-started/new-project"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Documentation
              </Link>
              <Link
                href="https://github.com/ponder-sh/ponder/tree/main/examples"
                target="_blank"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Examples
              </Link>
              <Link
                href="https://github.com/ponder-sh/ponder"
                target="_blank"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                GitHub
              </Link>
            </div>
            <div className="w-36 md:w-48 flex flex-col">
              <h4 className="mb-5 text-neutral-800 dark:text-neutral-100 font-semibold">
                More
              </h4>
              <Link
                href="/blog"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Blog
              </Link>
              <Link
                href="https://github.com/ponder-sh/ponder/releases"
                target="_blank"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Releases
              </Link>
              <Link
                href="/docs/advanced/telemetry"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Telemetry
              </Link>
            </div>
            <div className="w-36 md:w-48 flex flex-col">
              <h4 className="mb-5 text-neutral-800 dark:text-neutral-100 font-semibold">
                Connect
              </h4>
              <Link
                href="mailto:jobs@ponder.sh"
                target="_blank"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Jobs
              </Link>
              <Link
                href="https://twitter.com/ponder_sh"
                target="_blank"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Twitter
              </Link>
              <Link
                href="https://warpcast.com/typedarray.eth"
                target="_blank"
                className="mb-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Farcaster
              </Link>
            </div>
          </div>
        </div>

        <span className="mt-8">© 2024 Cantrip, Inc.</span>
      </div>
    </div>
  );
}
