// import { useConfig } from "nextra-theme-docs";

/**
 * @type {import('nextra-theme-docs').DocsThemeConfig}
 */
const config = {
  // projectLink: "https://github.com/0xOlias/ponder",
  project: {
    link: "https://github.com/0xOlias/ponder",
  },
  chat: {
    icon: null,
  },
  docsRepositoryBase: "https://github.com/0xOlias/ponder/tree/main/docs/pages",
  logo: (
    <>
      <span className="mr-2 font-extrabold hidden md:inline">Ponder</span>
      {/* <span className="text-gray-600 font-normal hidden md:inline">
        The ... framework
      </span> */}
    </>
  ),

  navigation: {
    prev: true,
    next: true,
  },
  footerEditLink: "Edit this page on GitHub",
  footer: {
    component: null,
    // content: (
    //   <span>
    //     MIT ${new Date().getFullYear()} ©{" "}
    //     <a href="https://nextra.site" target="_blank" rel="noreferrer">
    //       Nextra
    //     </a>
    //     .
    //   </span>
    // ),
  },
  unstable_faviconGlyph: "👋",
  nextThemes: {
    defaultTheme: "dark",
  },
  getNextSeoProps() {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    // const { frontMatter } = useConfig();
    return {
      additionalLinkTags: [
        {
          href: "/apple-icon-180x180.png",
          rel: "apple-touch-icon",
          sizes: "180x180",
        },
        {
          href: "/android-icon-192x192.png",
          rel: "icon",
          sizes: "192x192",
          type: "image/png",
        },
        {
          href: "/favicon-96x96.png",
          rel: "icon",
          sizes: "96x96",
          type: "image/png",
        },
        {
          href: "/favicon-32x32.png",
          rel: "icon",
          sizes: "32x32",
          type: "image/png",
        },
        {
          href: "/favicon-16x16.png",
          rel: "icon",
          sizes: "16x16",
          type: "image/png",
        },
      ],
      additionalMetaTags: [
        { content: "en", httpEquiv: "Content-Language" },
        { content: "Ponder", name: "apple-mobile-web-app-title" },
        { content: "#fff", name: "msapplication-TileColor" },
        { content: "/ms-icon-144x144.png", name: "msapplication-TileImage" },
      ],
      // description:
      //   frontMatter.description || "Nextra: the Next.js site builder",
      // openGraph: {
      //   images: [
      //     { url: frontMatter.image || "https://nextra.vercel.app/og.png" },
      //   ],
      // },
      titleTemplate: "%s – Ponder",
      // twitter: {
      //   cardType: "summary_large_image",
      //   site: "https://nextra.vercel.app",
      // },
    };
  },
};

export default config;
