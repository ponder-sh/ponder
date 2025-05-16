import { useEffect } from "react";
import { cn } from "./utils";

export function Footer() {
  useEffect(() => {
    const vocsFooter = document.querySelector(
      ".vocs_Footer",
    ) as HTMLElement | null;
    if (vocsFooter) {
      vocsFooter.style.display = "none";
    }
    return () => {
      if (vocsFooter) {
        vocsFooter.style.display = "flex";
      }
    };
  }, []);

  return (
    <footer className="w-full max-w-full relative pt-8">
      <div
        className="max-w-[1180px] mx-auto border-t-[0.5px]"
        style={{ borderTop: "1px solid var(--vocs-color_border)" }}
      >
        <div className="pt-12 pb-6 flex flex-col gap-12 justify-between md:flex-row">
          <div className="flex gap-4 flex-row justify-between items-center md:flex-col md:justify-start md:items-start">
            <img
              src="/ponder-light.svg"
              alt="Ponder"
              className="h-[13.5px] dark:hidden"
            />
            <img
              src="/ponder-dark.svg"
              alt="Ponder"
              className="h-[13.5px] hidden dark:block"
            />

            <Socials className="-ml-1 mt-auto" />
          </div>

          <div className="flex flex-wrap gap-y-12 md:flex-row text-sm">
            <div className="flex flex-col gap-3 w-36 md:w-44">
              <h4 className="font-semibold pb-2">Resources</h4>
              <a href="/docs/get-started/new-project">Documentation</a>
              <a
                href="https://github.com/ponder-sh/ponder/tree/main/examples"
                target="_blank"
                rel="noreferrer"
              >
                Examples
              </a>
              <a
                href="https://github.com/ponder-sh/ponder"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
            <div className="flex flex-col gap-3 w-36 md:w-44">
              <h4 className="font-semibold pb-2">More</h4>
              <a href="/blog">Blog</a>
              <a
                href="https://github.com/ponder-sh/ponder/releases"
                target="_blank"
                rel="noreferrer"
              >
                Releases
              </a>
              <a href="/docs/advanced/telemetry">Telemetry</a>
            </div>
            <div className="flex flex-col gap-3 w-36 md:w-44">
              <h4 className="font-semibold pb-2">Connect</h4>
              <a href="mailto:jobs@ponder.sh" target="_blank" rel="noreferrer">
                Jobs
              </a>
              <a
                href="https://twitter.com/ponder_sh"
                target="_blank"
                rel="noreferrer"
              >
                Twitter
              </a>
              <a
                href="https://warpcast.com/typedarray.eth"
                target="_blank"
                rel="noreferrer"
              >
                Farcaster
              </a>
            </div>
          </div>
        </div>

        <span className="text-sm">© 2025 Cantrip, Inc.</span>
      </div>
    </footer>
  );
}

function Socials(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;

  return (
    <div className={cn("vocs_Socials", className)} {...rest}>
      <a
        className="vocs_Socials_button"
        href="https://github.com/ponder-sh/ponder"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div
          aria-label="GitHub"
          className="vocs_Icon vocs_Socials_icon"
          role="img"
          style={{ height: "17px", width: "17px" }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 98 96"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>GitHub</title>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
              fill="currentColor"
            />
          </svg>
        </div>
      </a>
      <div
        style={{
          width: "1px",
          marginTop: "var(--vocs-space_4)",
          marginBottom: "var(--vocs-space_4)",
          backgroundColor: "var(--vocs-color_border)",
        }}
      />
      <a
        className="vocs_Socials_button"
        href="https://t.me/ponder_sh"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div
          aria-label="Telegram"
          className="vocs_Icon vocs_Socials_icon"
          role="img"
          style={{ height: "17px", width: "17px" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="100%"
            height="100%"
            viewBox="0 0 50 50"
          >
            <title>Telegram</title>
            <path
              d="M25 2c12.703 0 23 10.297 23 23S37.703 48 25 48 2 37.703 2 25 12.297 2 25 2zm7.934 32.375c.423-1.298 2.405-14.234 2.65-16.783.074-.772-.17-1.285-.648-1.514-.578-.278-1.434-.139-2.427.219-1.362.491-18.774 7.884-19.78 8.312-.954.405-1.856.847-1.856 1.487 0 .45.267.703 1.003.966.766.273 2.695.858 3.834 1.172 1.097.303 2.346.04 3.046-.395.742-.461 9.305-6.191 9.92-6.693.614-.502 1.104.141.602.644-.502.502-6.38 6.207-7.155 6.997-.941.959-.273 1.953.358 2.351.721.454 5.906 3.932 6.687 4.49.781.558 1.573.811 2.298.811.725 0 1.107-.955 1.468-2.064z"
              fill="currentColor"
            />
          </svg>
        </div>
      </a>
      <div
        style={{
          width: "1px",
          marginTop: "var(--vocs-space_4)",
          marginBottom: "var(--vocs-space_4)",
          backgroundColor: "var(--vocs-color_border)",
        }}
      />
      <a
        className="vocs_Socials_button"
        href="https://x.com/ponder_sh"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div
          aria-label="X (Twitter)"
          className="vocs_Icon vocs_Socials_icon"
          role="img"
          style={{ height: "16px", width: "16px" }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1200 1227"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>X</title>
            <path
              d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </a>
    </div>
  );
}
