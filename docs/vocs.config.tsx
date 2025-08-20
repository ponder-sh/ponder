import { remarkMermaid } from "@theguild/remark-mermaid";
import { defineConfig } from "vocs";
import { getCanonicalSubpath, sidebar } from "./sidebar";

const baseUrl =
  process.env.VERCEL_ENV === "production"
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173";

export default defineConfig({
  title: "Ponder",
  titleTemplate: "%s – Ponder",
  banner: {
    // @ts-expect-error
    dismissable: "false",
    backgroundColor: "var(--vocs-color_heading)",
    textColor: "var(--vocs-color_background)",
    content: (
      <div>
        Introducing{" "}
        <a href="https://marble.xyz" target="_blank">
          Marble
        </a>
        , the company behind Ponder
      </div>
    ),
    height: "36px",
  },
  description:
    "Ponder is an open-source backend framework for robust, performant, and maintainable crypto apps.",
  rootDir: ".",
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
      if (documentId.startsWith("pages/docs/0.10")) return 0;
      if (documentId.startsWith("pages/docs/0.11")) return 0;
      if (documentId.startsWith("pages/docs/api-reference")) return 0.25;
      return 1;
    },
  },
  /**
   * The `path` argument looks like '/docs/0.11/schema/relations' or '/docs/advanced/observability'.
   * To improve SEO and LLM indexing, we want to add canonical tags to the head for any non-latest pages.
   */
  head({ path }) {
    const canonicalSubpath = getCanonicalSubpath(path);
    const canonicalTag = canonicalSubpath ? (
      <link rel="canonical" href={`${baseUrl}${canonicalSubpath}`} />
    ) : null;

    return (
      <>
        {canonicalTag}
        <link rel="preload" as="image" href="/hero.png" />
        <script async src="https://sa-api.ponder.sh/latest.js" />
        <noscript>
          <img
            src="https://sa-api.ponder.sh/noscript.gif"
            alt=""
            referrerPolicy="no-referrer-when-downgrade"
          />
        </noscript>
      </>
    );
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
    pattern: "https://github.com/ponder-sh/ponder/edit/main/docs/pages/:path",
    text: "Suggest changes",
  },
  theme: {
    accentColor: {
      light: "#0a9fb2",
      dark: "#10c2d5",
    },
    variables: {
      content: {
        width: "calc(70ch + (var(--vocs-content_horizontalPadding) * 2))",
      },
      fontSize: {
        codeBlock: "13px", // Default: 14px
      },
    },
  },
});
