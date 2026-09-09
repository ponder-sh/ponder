import type { ReactNode } from "react";
import { Layout } from "vocs";
import { OutdatedVersionCallout } from "../../components/outdated-version-callout";

/**
 * Wraps every page under `/docs`.
 *
 * IMPORTANT: an `_mdx-wrapper` *replaces* Vocs' default `Layout` for its
 * subtree rather than nesting inside it, so it must render `<Layout>` itself —
 * that is what emits `<Head>` (title, canonical, OG tags) and the docs shell
 * (sidebar, top nav, outline, pagination). Dropping it silently renders bare
 * content with no chrome and no metadata.
 *
 * Kept as a server component so it can render `Layout`; the callout carries
 * its own `'use client'` boundary.
 */
export default function DocsWrapper({ children }: { children: ReactNode }) {
  return (
    <Layout>
      <OutdatedVersionCallout />
      {children}
    </Layout>
  );
}
