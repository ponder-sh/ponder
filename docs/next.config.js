const withNextra = require("nextra")({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.tsx",
  defaultShowCopyCode: true,
  flexsearch: {
    codeblocks: true,
  },
  staticImage: true,
});

module.exports = withNextra({
  redirects() {
    return [
      // Temp redirect before we build a `blog/` TOC page.
      {
        source: "/blog",
        destination: "/blog/introducing-ponder",
        permanent: false,
      },
      // Redirects from before docs pages including `docs/` path prefix.
      {
        source: "/api-reference/:slug*",
        destination: "/docs/api-reference/:slug*",
        permanent: true,
      },
      {
        source: "/getting-started/:slug*",
        destination: "/docs/getting-started/:slug*",
        permanent: true,
      },
      {
        source: "/guides/:slug*",
        destination: "/docs/guides/:slug*",
        permanent: true,
      },
      {
        source: "/migration-guide/:slug*",
        destination: "/docs/migration-guide/:slug*",
        permanent: true,
      },
      {
        source: "/compared-to-subgraphs/:slug*",
        destination: "/docs/compared-to-subgraphs/:slug*",
        permanent: true,
      },
      {
        source: "/advanced/:slug*",
        destination: "/docs/advanced/:slug*",
        permanent: true,
      },
    ];
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
});
