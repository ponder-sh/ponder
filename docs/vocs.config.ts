import { remarkMermaid } from "@theguild/remark-mermaid";
import { defineConfig } from "vocs/config";
import { sidebar } from "./sidebar.ts";

const baseUrl =
  process.env.VERCEL_ENV === "production"
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173";

export default defineConfig({
  accentColor: "light-dark(#0a9fb2, #10c2d5)",
  title: "Ponder",
  titleTemplate: "%s – Ponder",
  description:
    "Ponder is an open-source TypeScript framework for EVM data indexing.",
  rootDir: ".",
  srcDir: ".",
  iconUrl: { light: "/icon.png", dark: "/icon.png" },
  logoUrl: { light: "/ponder-light.svg", dark: "/ponder-dark.svg" },
  baseUrl,
  ogImageUrl: `${baseUrl}/api/og?title=%title&description=%description`,
  markdown: { remarkPlugins: [remarkMermaid] },
  sidebar,
  topNav: [
    { text: "Docs", link: "/docs/get-started", match: "/docs" },
    { text: "Blog", link: "/blog" },
    {
      text: "Examples",
      link: "https://github.com/ponder-sh/ponder/tree/main/examples",
    },
    {
      text: "Resources",
      items: [
        {
          text: "Migration guide",
          link: "/docs/migration-guide",
        },
        {
          text: "Community chat",
          link: "https://t.me/pondersh",
        },
        {
          text: "GitHub issues",
          link: "https://github.com/ponder-sh/ponder/issues",
        },
        {
          text: "Changelog",
          link: "https://github.com/ponder-sh/ponder/blob/main/packages/core/CHANGELOG.md",
        },
        {
          text: "Contribute",
          link: "https://github.com/ponder-sh/ponder/blob/main/.github/CONTRIBUTING.md",
        },
      ],
    },
  ],
  search: {
    boostDocument(documentId) {
      // Ignore older versioned docs at "pages/docs/{number}"
      if (/^pages\/docs\/\d+/.test(documentId)) return 0;
      if (documentId.startsWith("pages/docs/api-reference")) return 0.5;
      return 1;
    },
  },
  /**
   * The `path` argument looks like '/docs/0.11/schema/relations' or '/docs/advanced/observability'.
   * To improve SEO and LLM indexing, we want to add canonical tags to the head for any non-latest pages.
   */
  head(path) {
    const currentPath = path ?? "/";
    const isVersionedPath = /^\/docs\/0\.(?:10|11|12|14|15)(\/|$)/.test(
      currentPath,
    );
    const canonicalSubpath = currentPath.replace(
      /^\/docs\/0\.(?:10|11|12|14|15)(\/|$)/,
      "/docs$1",
    );
    const headBaseUrl =
      process.env.VERCEL_ENV === "production"
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:5173";

    return {
      canonical: isVersionedPath
        ? `${headBaseUrl}${canonicalSubpath}`
        : false,
      link: [{ rel: "preload", as: "image", href: "/hero.png" }],
      script: [
        {
          async: true,
          src: "https://sa-api.ponder.sh/latest.js",
        },
      ],
    };
  },
  socials: [
    {
      icon: "github",
      link: "https://github.com/ponder-sh/ponder",
    },
    {
      icon: "telegram",
      link: "https://t.me/pondersh",
    },
    {
      icon: "x",
      link: "https://x.com/ponder_sh",
    },
    // {
    //   icon: "warpcast",
    //   link: "https://warpcast.com/~/channel/ponder-sh",
    // },
  ],
  editLink: {
    link: "https://github.com/ponder-sh/ponder/edit/main/docs/pages/:path",
    text: "Suggest changes",
  },
});
