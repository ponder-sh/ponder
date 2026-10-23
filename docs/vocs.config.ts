import { defineConfig } from "vocs/config";
import { redirects } from "./redirects.ts";
import { sidebar } from "./sidebar.ts";

export default defineConfig({
  title: "Ponder",
  titleTemplate: "%s – Ponder",
  description:
    "Ponder is an open-source TypeScript framework for EVM data indexing.",
  baseUrl:
    process.env.VERCEL_ENV === "production"
      ? "https://ponder.sh"
      : process.env.VERCEL_URL,
  iconUrl: "/icon.png",
  logoUrl: { light: "/ponder-light.svg", dark: "/ponder-dark.svg" },
  accentColor: "light-dark(#0a9fb2, #10c2d5)",
  ogImageUrl: (path, { baseUrl }) => {
    if (path === "/") return "/og.png";
    return `${baseUrl}/api/og?logo=%logo&title=%title&description=%description`;
  },
  renderStrategy: "partial-static",
  rootDir: ".",
  srcDir: ".",
  twoslash: false,
  // The versioned docs contain many links to pages that only exist in other
  // versions. Report them without failing the build.
  checkDeadlinks: "warn",
  redirects,
  sidebar,
  topNav: [
    { text: "Docs", link: "/docs/get-started", match: "/docs" },
    { text: "Blog", link: "/blog", match: "/blog" },
    {
      text: "Examples",
      link: "https://github.com/ponder-sh/ponder/tree/main/examples",
    },
    {
      text: "Resources",
      items: [
        { text: "Migration guide", link: "/docs/migration-guide" },
        { text: "Community chat", link: "https://t.me/pondersh" },
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
  socials: [
    { icon: "github", link: "https://github.com/ponder-sh/ponder" },
    { icon: "telegram", link: "https://t.me/pondersh" },
    { icon: "x", link: "https://x.com/ponder_sh" },
  ],
  editLink: {
    link: "https://github.com/ponder-sh/ponder/edit/main/docs/pages/:path",
    text: "Suggest changes",
  },
  head(path) {
    // Versioned docs pages render a canonical link to the latest version of
    // the page in `pages/docs/_mdx-wrapper.tsx`.
    if (/^\/docs\/\d+\.\d+(\/|$)/.test(path)) return { canonical: false };
    return undefined;
  },
  search: {
    query: {
      // This function is serialized and sent to the browser, so it must not
      // reference anything outside its own body.
      boostDocument(_id, _term, storedFields) {
        const href = storedFields?.href as string | undefined;
        // Ignore older versioned docs at "/docs/{number}".
        if (href && /^\/docs\/\d+/.test(href)) return 0;
        if (href?.startsWith("/docs/api-reference")) return 0.5;
        return 1;
      },
    },
  },
});
