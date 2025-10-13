import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import pkg from "../packages/core/package.json";
import { cn } from "./components/utils";
import { getBestSubpathForVersion, getCanonicalSubpath } from "./sidebar";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function Layout({ children }: { children: React.ReactNode }) {
  const sidebarHostRef = useRef<HTMLDivElement | null>(null);
  const sidebarMobileHostRef = useRef<HTMLDivElement | null>(null);
  const contentHostRef = useRef<HTMLDivElement | null>(null);

  /* -----------------------------------------------------------
   * 1️⃣  Create the host *during render* on the client.
   *     This gives React something to portal into immediately.
   * --------------------------------------------------------- */
  if (typeof window !== "undefined" && !sidebarHostRef.current)
    sidebarHostRef.current = document.createElement("div");
  if (typeof window !== "undefined" && !sidebarMobileHostRef.current)
    sidebarMobileHostRef.current = document.createElement("div");
  if (typeof window !== "undefined" && !contentHostRef.current)
    contentHostRef.current = document.createElement("div");

  /* -----------------------------------------------------------
   * 2️⃣  Insert (and re‑insert) the host whenever the sidebar
   *     exists.  MutationObserver handles sidebar re‑mounts.
   * --------------------------------------------------------- */
  useIsomorphicLayoutEffect(() => {
    const sidebarHost = sidebarHostRef.current!;
    const attachSidebar = () => {
      const sidebarElements = document.querySelectorAll<HTMLElement>(
        "nav.vocs_Sidebar_navigation",
      );
      const sidebarDesktop = sidebarElements[0];

      if (sidebarDesktop && !sidebarDesktop.contains(sidebarHost)) {
        sidebarDesktop.insertBefore(sidebarHost, sidebarDesktop.firstChild);
      }
    };

    const sidebarMobileHost = sidebarMobileHostRef.current!;
    const attachSidebarMobile = () => {
      const sidebarElements = document.querySelectorAll<HTMLElement>(
        "nav.vocs_Sidebar_navigation",
      );
      const sidebarMobile = sidebarElements[1];
      if (sidebarMobile && !sidebarMobile.contains(sidebarMobileHost)) {
        sidebarMobile.insertBefore(sidebarMobileHost, sidebarMobile.firstChild);
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

    // initial page load
    attachSidebar();
    attachSidebarMobile();
    attachContent();

    // re-attach on sidebar re-mount
    const obs = new MutationObserver(() => {
      attachSidebar();
      attachSidebarMobile();
      attachContent();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      obs.disconnect();
      sidebarHost.remove();
      sidebarMobileHost.remove();
      contentHost.remove();
    };
  }, []);

  return (
    <>
      {children}
      {/* sidebarHostRef.current is already defined on the client's first render */}
      {sidebarHostRef.current &&
        createPortal(<VersionPickerDesktop />, sidebarHostRef.current)}
      {sidebarMobileHostRef.current &&
        createPortal(<VersionPickerMobile />, sidebarMobileHostRef.current)}
      {contentHostRef.current &&
        createPortal(<OutdatedVersionCallout />, contentHostRef.current)}
    </>
  );
}

const versions = [
  {
    key: "latest",
    label: "Latest Version",
    activeLabel: "Latest Version",
    patch: pkg.version,
    prefix: "/docs",
    home: "/get-started",
    isLatest: true,
  },
  {
    key: "0.12",
    label: "Versions 0.12 - 0.13",
    activeLabel: "Versions 0.12 - 0.13",
    patch: `0.13.13, 0.12.26`,
    prefix: "/docs",
    home: "/get-started",
    isLatest: false,
  },
  {
    key: "0.11",
    label: "Version 0.11",
    activeLabel: "Version 0.11",
    patch: "0.11.43",
    prefix: "/docs/0.11",
    isLatest: false,
  },
  {
    key: "0.10",
    label: "Version 0.10",
    activeLabel: "Version 0.10",
    patch: "0.10.26",
    prefix: "/docs/0.10",
    isLatest: false,
  },
] as const;

function VersionPickerDesktop() {
  const { pathname: subpath } = useLocation();
  const activeVersion = [...versions]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((v) => subpath.startsWith(v.prefix));

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
            className="z-50 w-[calc(var(--vocs-sidebar_width)-2*var(--vocs-sidebar\_horizontalPadding)+26px)] bg-[var(--vocs-color_background)] border border-[var(--vocs-color_border)] text-[length:var(--vocs-fontSize_14)] font-[var(--vocs-fontWeight_medium)] rounded-lg flex flex-col shadow-lg"
          >
            {versions.map((toVersion, index) => (
              <DropdownMenu.Item
                key={toVersion.prefix}
                asChild
                className={cn(
                  "pt-[10px] pb-[10px] px-[12px]",
                  "hover:outline-none hover:bg-[var(--vocs-color_background4)]",
                  "cursor-pointer",
                  {
                    "rounded-t-md": index === 0,
                    "rounded-b-md": index === versions.length - 1,
                  },
                )}
              >
                <Link to={getBestSubpathForVersion(subpath, activeVersion.key, toVersion.key)}>
                  <div className="flex flex-col items-start gap-1 leading-tight">
                    <span className="vocs_Sidebar_sectionTitle">{toVersion.label}</span>
                    <span className="text-[11px] text-[var(--vocs-color_text3)]">
                      {toVersion.patch}
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

function VersionPickerMobile() {
  const { pathname: subpath } = useLocation();
  const activeVersion = [...versions]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((v) => subpath.startsWith(v.prefix));

  if (!activeVersion) return null;

  return (
    <div className="pt-2 flex flex-col">
      {versions.map((toVersion) => (
        <Link
          to={getBestSubpathForVersion(subpath, activeVersion.key, toVersion.key)}
          key={toVersion.prefix}
          className={cn(
            "flex flex-row items-center justify-between",
            "pt-[10px] pb-[10px]",
            "hover:outline-none",
            "cursor-pointer rounded-lg",
          )}
        >
          <div className="flex flex-col items-start gap-1 leading-tight">
            <span className="vocs_Sidebar_sectionTitle">{toVersion.label}</span>
            <span className="text-[11px] text-[var(--vocs-color_text3)]">
              {toVersion.patch}
            </span>
          </div>
          {toVersion.label === activeVersion.label && <CheckIcon className="w-4 h-4" />}
        </Link>
      ))}
    </div>
  );
}

function OutdatedVersionCallout() {
  const { pathname } = useLocation();
  const activeVersion = [...versions]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((v) => pathname.startsWith(v.prefix));

  if (activeVersion === undefined || activeVersion.isLatest) return null;

  const latestHref = getCanonicalSubpath(pathname)
  const latestAnchorTag = latestHref ? <> Visit the <a className="vocs_Anchor" href={latestHref}>latest version</a> of this page.</> : null

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
          You are viewing the documentation for an outdated version of Ponder.{' '}
          {latestAnchorTag}
        </p>
      </div>
    </aside>
  );
}
