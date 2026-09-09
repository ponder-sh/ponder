import { Footer as SiteFooter } from "../components/footer";
import { VersionPicker } from "../components/version-picker";

/**
 * Vocs layout slots. Exported components are injected into the docs shell:
 * `SidebarHeader` above the sidebar navigation and `Footer` beneath every page.
 *
 * Kept as a server component — `VersionPicker` carries its own `'use client'`
 * boundary so the footer does not become a client component too.
 */
export function SidebarHeader() {
  return <VersionPicker />;
}

export function Footer() {
  return <SiteFooter />;
}
