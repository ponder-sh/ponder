import Link from "next/link";
import { GitHubIcon } from "nextra/icons";

import PonderLogo from "../public/ponder.svg";
import { TelegramIcon, TwitterIcon } from "./icons";

export function Footer() {
  return (
    <div className="w-full text-sm">
      <div className="flex flex-col w-full">
        <div className="flex flex-col gap-12 justify-between w-full md:flex-row">
          <div className="flex flex-row justify-between items-center md:flex-col md:items-start">
            <>
              <PonderLogo className="logo" />
              <span className="_sr-only">Ponder</span>
            </>

            <div className="flex flex-row gap-[10px]">
              <Link href="https://github.com/ponder-sh/ponder" target="_blank">
                <GitHubIcon className="h-5 transition-colors text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100" />
                <span className="_sr-only">GitHub</span>
              </Link>

              <div className="min-h-full w-[1px] bg-neutral-300 dark:bg-neutral-600" />

              <Link href="https://t.me/ponder_sh" target="_blank">
                <TelegramIcon className="h-5 transition-colors text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100" />
                <span className="_sr-only">Telegram</span>
              </Link>

              <div className="min-h-full w-[1px] bg-neutral-300 dark:bg-neutral-600" />

              <Link href="https://twitter.com/ponder_sh" target="_blank">
                <TwitterIcon className="w-5 h-5 transition-colors text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100" />
                <span className="_sr-only">Twitter</span>
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap gap-y-12 md:flex-row">
            <div className="flex flex-col w-36 md:w-48">
              <h4 className="mb-5 font-semibold text-neutral-800 dark:text-neutral-100">
                Resources
              </h4>
              <Link
                href="/docs/getting-started/new-project"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Documentation
              </Link>
              <Link
                href="https://github.com/ponder-sh/ponder/tree/main/examples"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Examples
              </Link>
              <Link
                href="https://github.com/ponder-sh/ponder"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                GitHub
              </Link>
            </div>
            <div className="flex flex-col w-36 md:w-48">
              <h4 className="mb-5 font-semibold text-neutral-800 dark:text-neutral-100">
                More
              </h4>
              <Link
                href="/blog"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Blog
              </Link>
              <Link
                href="https://github.com/ponder-sh/ponder/releases"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Releases
              </Link>
              <Link
                href="/docs/advanced/telemetry"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Telemetry
              </Link>
            </div>
            <div className="flex flex-col w-36 md:w-48">
              <h4 className="mb-5 font-semibold text-neutral-800 dark:text-neutral-100">
                Connect
              </h4>
              <Link
                href="mailto:jobs@ponder.sh"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Jobs
              </Link>
              <Link
                href="https://twitter.com/ponder_sh"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Twitter
              </Link>
              <Link
                href="https://warpcast.com/typedarray.eth"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Farcaster
              </Link>
            </div>
          </div>
        </div>

        <span className="mt-8">© 2025 Cantrip, Inc.</span>
      </div>
    </div>
  );
}
