import { useRouter } from "next/router";
import { GitHubIcon } from "nextra/icons";
import type { DocsThemeConfig } from "nextra-theme-docs";
import { useConfig } from "nextra-theme-docs";

import { Footer } from "./components/Footer";
import { TelegramIcon } from "./components/icons";
import PonderLogo from "./public/ponder.svg";

const config: DocsThemeConfig = {
  logo: (
    <>
      <PonderLogo className="logo" />
      <span className="_sr-only">Ponder</span>
    </>
  ),
  project: {
    link: "https://github.com/ponder-sh/ponder",
    icon: (
      <>
        <GitHubIcon className="text-neutral-800 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors" />
        <span className="_sr-only">GitHub</span>
      </>
    ),
  },
  chat: {
    link: "https://t.me/ponder_sh",
    icon: (
      <>
        <TelegramIcon className="text-neutral-800 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors" />
        <span className="_sr-only">Telegram</span>
      </>
    ),
  },
  footer: {
    content: <Footer />,
  },
  color: {
    hue: { dark: 186, light: 186 },
    saturation: { dark: 86, light: 86 },
  },
  docsRepositoryBase: "https://github.com/ponder-sh/ponder/tree/main/docs",
  sidebar: {
    defaultMenuCollapseLevel: 2,
  },
  editLink: {
    content: "Edit this page on GitHub →",
  },
  toc: {
    backToTop: true,
  },
  feedback: {
    content: null,
  },
  navigation: {
    prev: true,
    next: true,
  },
  darkMode: true,
  nextThemes: {
    defaultTheme: "dark",
  },
  faviconGlyph: "🤔",
  head: function useHead() {
    const config = useConfig();
    const { route } = useRouter();

    const isDefault = route === "/" || !config.title;

    // Building Your Application: Caching | Next.js
    const title = isDefault
      ? "Ponder – A backend framework for crypto apps"
      : (config.frontMatter.title ?? "Documentation") + " – Ponder";

    // An overview of caching mechanisms in Next.js.
    const description =
      config.frontMatter.description ??
      "Ponder is an open-source framework for crypto apps focused on developer experience and performance.";

    const image =
      config.frontMatter.image ??
      "https://ponder.sh/" +
        (isDefault
          ? "og.png"
          : `api/og?title=${config.frontMatter.title}&description=${description}`);

    return (
      <>
        <title>{title}</title>

        <meta property="og:title" content={title} />
        <meta name="description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={image} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@ponder_sh" />
        <meta name="twitter:site:domain" content="ponder.sh" />
        <meta name="twitter:url" content="https://ponder.sh" />

        <meta httpEquiv="Content-Language" content="en" />
        <meta name="apple-mobile-web-app-title" content="Ponder" />
        <meta name="msapplication-TileColor" content="#fff" />

        {/* TODO: Uncomment when we have a favicon. */}
        {/* <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link
          rel="icon"
          href="/favicon-dark.svg"
          type="image/svg+xml"
          media="(prefers-color-scheme: dark)"
        />
        <link
          rel="icon"
          href="/favicon-dark.png"
          type="image/png"
          media="(prefers-color-scheme: dark)"
        /> */}

        {/* TODO: Test that these work correctly. */}
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#111111"
          media="(prefers-color-scheme: dark)"
        />
      </>
    );
  },
};

export default config;
