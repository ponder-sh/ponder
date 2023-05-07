import { defineConfig } from 'vitepress'
import { sidebar } from './sidebar'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en-US',
  title: 'ponder',
  description: 'Ponder is an open-source framework for blockchain application backends.',
  // TODO: head
  head: [],
  // TODO: themeing?
  markdown: {},
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    // TODO: https://github.com/typesense/typesense ?!
    search: { provider: 'local' },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Playground', link: 'https://playground.ponder.dev' },
      { text: 'GitHub', link: 'https://github.com/0xOlias/ponder' },
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: 'https://github.com/0xOlias/ponder' }],
  },
  /**
   * Non UI-related config
   */
  vite: {},
})
