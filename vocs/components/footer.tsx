// WIP

export default function Footer() {
  return (
    <div
      className="text-sm"
      style={{
        backgroundColor: "var(--vocs-color_background2)",
        paddingLeft: "calc(2 * var(--vocs-content_horizontalPadding))",
        paddingRight: "calc(2 * var(--vocs-content_horizontalPadding))",
        marginLeft: "calc(-1 * var(--vocs-content_horizontalPadding))",
        marginRight: "calc(-1 * var(--vocs-content_horizontalPadding))",
      }}
    >
      <div className="flex flex-col w-full">
        <div className="flex flex-col gap-12 justify-between w-full md:flex-row">
          <div className="flex flex-row justify-between items-center md:flex-col md:items-start">
            <>
              <img src="/ponder-dark.svg" alt="Ponder" className="h-[13.5px]" />
              {/* <span className="_sr-only">Ponder</span> */}
            </>

            {/* <div className="flex flex-row gap-[10px]">
              <a href="https://github.com/ponder-sh/ponder" target="_blank">
                <GitHubIcon className="h-5 transition-colors text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100" />
                <span className="_sr-only">GitHub</span>
              </a>

              <div className="min-h-full w-[1px] bg-neutral-300 dark:bg-neutral-600" />

              <a href="https://t.me/ponder_sh" target="_blank">
                <TelegramIcon className="h-5 transition-colors text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100" />
                <span className="_sr-only">Telegram</span>
              </a>

              <div className="min-h-full w-[1px] bg-neutral-300 dark:bg-neutral-600" />

              <a href="https://twitter.com/ponder_sh" target="_blank">
                <TwitterIcon className="w-5 h-5 transition-colors text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100" />
                <span className="_sr-only">Twitter</span>
              </a>
            </div> */}
          </div>

          <div className="flex flex-wrap gap-y-12 md:flex-row">
            <div className="flex flex-col w-36 md:w-48">
              <h4 className="mb-5 font-semibold text-neutral-800 dark:text-neutral-100">
                Resources
              </h4>
              <a
                href="/docs/getting-started/new-project"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Documentation
              </a>
              <a
                href="https://github.com/ponder-sh/ponder/tree/main/examples"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                rel="noreferrer"
              >
                Examples
              </a>
              <a
                href="https://github.com/ponder-sh/ponder"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
            <div className="flex flex-col w-36 md:w-48">
              <h4 className="mb-5 font-semibold text-neutral-800 dark:text-neutral-100">
                More
              </h4>
              <a
                href="/blog"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Blog
              </a>
              <a
                href="https://github.com/ponder-sh/ponder/releases"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                rel="noreferrer"
              >
                Releases
              </a>
              <a
                href="/docs/advanced/telemetry"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Telemetry
              </a>
            </div>
            <div className="flex flex-col w-36 md:w-48">
              <h4 className="mb-5 font-semibold text-neutral-800 dark:text-neutral-100">
                Connect
              </h4>
              <a
                href="mailto:jobs@ponder.sh"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                rel="noreferrer"
              >
                Jobs
              </a>
              <a
                href="https://twitter.com/ponder_sh"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                rel="noreferrer"
              >
                Twitter
              </a>
              <a
                href="https://warpcast.com/typedarray.eth"
                target="_blank"
                className="mb-3 transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                rel="noreferrer"
              >
                Farcaster
              </a>
            </div>
          </div>
        </div>

        <span className="mt-8">© 2025 Cantrip, Inc.</span>
      </div>
    </div>
  );
}
