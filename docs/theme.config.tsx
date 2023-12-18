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
    const image =
      "https://ponder.sh/" +
      (isDefault ? "og.png" : `api/og?title=${config.title}`);

    const description =
      config.frontMatter.description ||
      "Ponder – A backend framework for crypto apps";
    const title = config.title + (route === "/" ? "" : " – Ponder");

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

  // useNextSeoProps() {
  //   const { route } = useRouter();
  //   const { frontMatter } = useConfig();

  //   const defaultSeoProps = {
  //     description: "Ponder is a backend framework for crypto apps.",
  //     openGraph: {
  //       description: "Ponder is a backend framework for crypto apps.",
  //       title: "Ponder – A backend framework for crypto apps",
  //       images: [{ url: "https://ponder.sh/og.png" }],
  //     },
  //     themeColor: "#FFFBF5",
  //     twitter: {
  //       cardType: "summary_large_image",
  //       handle: "@ponder_sh",
  //       site: "https://ponder.sh",
  //     },
  //   };

  //   if (!/^\/index/.test(route))
  //     return {
  //       ...defaultSeoProps,
  //       description: frontMatter.description,
  //       openGraph: {
  //         ...defaultSeoProps.openGraph,
  //         description: frontMatter.description,
  //         title: frontMatter.title,
  //         ...(frontMatter.image
  //           ? { images: [{ url: frontMatter.image }] }
  //           : {}),
  //       },
  //       titleTemplate: `%s – Ponder`,
  //     };
  //   return {
  //     ...defaultSeoProps,
  //     title: "Ponder – A backend framework for crypto apps",
  //   };
  // },
};

export default config;
