import { DefaultTheme } from 'vitepress'

export const sidebar: DefaultTheme.Sidebar = {
  '/docs/': [
    {
      text: 'Introduction',
      link: '/docs/introduction',
    },
    {
      text: 'Getting Started',
      link: '/docs/getting-started',
      items: [
        { text: 'Create a new project', link: '/docs/getting-started/new-project.md' },
        {
          text: 'Migrate a Graph Protocol subgraph',
          link: '/docs/getting-started/migrate-subgraph.md',
        },
      ],
    },
    {
      text: 'Guides',
      link: '/docs/guides',
      items: [
        { text: 'Design your schema', link: '/docs/guides/design-your-schema' },
        { text: 'Create & update entities', link: '/docs/guides/create-update-entities' },
        { text: 'Deploy to production', link: '/docs/guides/production' },
      ],
    },
    {
      text: 'API Reference',
      link: '/docs/api-reference',
      items: [
        { text: 'Create Ponder', link: '/docs/api-reference/create-ponder' },
        { text: 'Event handlers', link: '/docs/api-reference/event-handlers' },
        { text: 'ponder.config.ts', link: '/docs/api-reference/ponder-config' },
        { text: 'schema.graphql', link: '/docs/api-reference/schema-graphql' },
      ],
    },
    {
      text: 'FAQ',
      link: '/docs/faq',
      items: [
        { text: 'Ponder vs The Graph', link: '/docs/faq/vs-the-graph' },
        { text: 'How does Ponder store data?', link: '/docs/faq/database' },
      ],
    },
    {
      text: 'Advanced',
      link: '/docs/advanced',
      items: [
        { text: 'Custom log filters', link: '/docs/advanced/custom-filters' },
        { text: 'Proxy contracts', link: '/docs/advanced/proxy-contracts' },
      ],
    },
  ],
}
