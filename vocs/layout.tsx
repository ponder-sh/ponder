import { ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import pkg from "../packages/core/package.json";
import { cn } from "./components/utils";

// useLayoutEffect in the browser, useEffect during SSR
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function Layout({ children }: { children: React.ReactNode }) {
  const sidebarHostRef = useRef<HTMLDivElement | null>(null);
  const contentHostRef = useRef<HTMLDivElement | null>(null);

  /* -----------------------------------------------------------
   * 1️⃣  Create the host *during render* on the client.
   *     This gives React something to portal into immediately.
   * --------------------------------------------------------- */
  if (typeof window !== "undefined" && !sidebarHostRef.current)
    sidebarHostRef.current = document.createElement("div");
  if (typeof window !== "undefined" && !contentHostRef.current)
    contentHostRef.current = document.createElement("div");

  /* -----------------------------------------------------------
   * 2️⃣  Insert (and re‑insert) the host whenever the sidebar
   *     exists.  MutationObserver handles sidebar re‑mounts.
   * --------------------------------------------------------- */
  useIsomorphicLayoutEffect(() => {
    const sidebarHost = sidebarHostRef.current!;
    const attachSidebar = () => {
      const sidebar = document.querySelector<HTMLElement>(
        "nav.vocs_Sidebar_navigation",
      );
      if (sidebar && !sidebar.contains(sidebarHost)) {
        sidebar.insertBefore(sidebarHost, sidebar.firstChild);
      }
    };

    const contentHost = contentHostRef.current!;
    const attachContent = () => {
      const content = document.querySelector<HTMLElement>(
        "article.vocs_Content",
      );
      if (content && !content.contains(contentHost)) {
        contentHost.style.marginBottom = "0px";
        content.insertBefore(contentHost, content.firstChild);
      }
    };

    attachSidebar(); // initial page load
    attachContent(); // initial page load
    const obs = new MutationObserver(() => {
      attachSidebar();
      attachContent();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      obs.disconnect();
      sidebarHost.remove();
      contentHost.remove();
    };
  }, []);

  return (
    <>
      {children}
      {/* sidebarHostRef.current is already defined on the client’s first render */}
      {sidebarHostRef.current &&
        createPortal(<VersionPicker />, sidebarHostRef.current)}
      {contentHostRef.current &&
        createPortal(<OutdatedVersionCallout />, contentHostRef.current)}
    </>
  );
}

/* ------------ VersionPicker stays unchanged ---------------- */

const versions = [
  {
    label: "Latest version",
    activeLabel: "Using latest version",
    patch: pkg.version,
    prefix: "/docs",
    destination: "/docs/get-started",
    isLatest: true,
  },
  {
    label: "Version 0.10",
    activeLabel: "Using version 0.10",
    patch: "0.10.26",
    prefix: "/docs/0.10",
    destination: "/docs/0.10/get-started",
    isLatest: false,
  },
];

function VersionPicker() {
  const { pathname } = useLocation();
  const activeVersion = [...versions]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((v) => pathname.startsWith(v.prefix));

  if (!activeVersion) return null;

  return (
    <div className="pt-4">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex flex-row items-center justify-between py-[10px] -my-[2px] px-[12px] -mx-[12px] w-[calc(var(--vocs-sidebar_width)-2*var(--vocs-sidebar\_horizontalPadding)+24px)] rounded-lg hover:bg-[var(--vocs-color_background4)]"
          >
            <div className="flex flex-col items-start gap-1 leading-tight">
              <span className="vocs_Sidebar_sectionTitle">
                {activeVersion.activeLabel}
              </span>
              <span className="text-[11px] text-[var(--vocs-color_text3)] -mb-[2px]">
                {activeVersion.patch}
              </span>
            </div>

            <ChevronsUpDown className="w-4 h-4" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            alignOffset={-1}
            className="z-[15] w-[calc(var(--vocs-sidebar_width)-2*var(--vocs-sidebar\_horizontalPadding)+26px)] bg-[var(--vocs-color_background)] border border-[var(--vocs-color_border)] text-[length:var(--vocs-fontSize_14)] font-[var(--vocs-fontWeight_medium)] rounded-lg flex flex-col shadow-lg"
          >
            {versions.map((v, index) => (
              <DropdownMenu.Item
                key={v.prefix}
                asChild
                className={cn(
                  "pt-[9px] pb-[9px] px-[12px]",
                  "hover:outline-none hover:bg-[var(--vocs-color_background4)]",
                  "cursor-pointer",
                  {
                    "rounded-t-lg": index === 0,
                    "rounded-b-lg": index === versions.length - 1,
                  },
                )}
              >
                <Link to={v.destination}>
                  <div className="flex flex-col items-start gap-1 leading-tight">
                    <span className="vocs_Sidebar_sectionTitle">{v.label}</span>
                    <span className="text-[11px] text-[var(--vocs-color_text3)]">
                      {v.patch}
                    </span>
                  </div>
                </Link>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function OutdatedVersionCallout() {
  const { pathname } = useLocation();
  const activeVersion = [...versions]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((v) => pathname.startsWith(v.prefix));

  if (activeVersion === undefined || activeVersion.isLatest) return null;

  return (
    <aside className="vocs_Aside vocs_Callout vocs_Callout_warning">
      <div className="vocs_Callout_icon">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 15 15"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Exclamation</title>
          <path
            d="M8.4449 0.608765C8.0183 -0.107015 6.9817 -0.107015 6.55509 0.608766L0.161178 11.3368C-0.275824 12.07 0.252503 13 1.10608 13H13.8939C14.7475 13 15.2758 12.07 14.8388 11.3368L8.4449 0.608765ZM7.4141 1.12073C7.45288 1.05566 7.54712 1.05566 7.5859 1.12073L13.9798 11.8488C14.0196 11.9154 13.9715 12 13.8939 12H1.10608C1.02849 12 0.980454 11.9154 1.02018 11.8488L7.4141 1.12073ZM6.8269 4.48611C6.81221 4.10423 7.11783 3.78663 7.5 3.78663C7.88217 3.78663 8.18778 4.10423 8.1731 4.48612L8.01921 8.48701C8.00848 8.766 7.7792 8.98664 7.5 8.98664C7.2208 8.98664 6.99151 8.766 6.98078 8.48701L6.8269 4.48611ZM8.24989 10.476C8.24989 10.8902 7.9141 11.226 7.49989 11.226C7.08567 11.226 6.74989 10.8902 6.74989 10.476C6.74989 10.0618 7.08567 9.72599 7.49989 9.72599C7.9141 9.72599 8.24989 10.0618 8.24989 10.476Z"
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <div className="vocs_Callout_content">
        <p className="vocs_Paragraph">
          You are viewing the documentation for an outdated version of Ponder.
        </p>
      </div>
    </aside>
  );
}
