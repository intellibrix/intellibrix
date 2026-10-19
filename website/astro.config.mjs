import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://intellibrix.dev',
  // The dev toolbar's audit app imports aria-query, which pnpm's strict layout can't resolve from the site.
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'intellibrix',
      description:
        'A model-agnostic TypeScript framework for building agents and AI-powered components.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/intellibrix/intellibrix' },
      ],
      editLink: { baseUrl: 'https://github.com/intellibrix/intellibrix/edit/master/website/' },
      sidebar: [
        { label: 'Start here', items: ['getting-started', 'concepts'] },
        {
          label: 'Guides',
          items: [
            'guides/tools-and-programs',
            'guides/testing',
            'guides/approvals-and-trust',
            'guides/choosing-a-model',
            'guides/custom-provider',
            'guides/mcp',
          ],
        },
        {
          label: 'Build with packages',
          items: [
            'guides/coding-agents',
            'guides/sandboxed-code',
            'guides/github',
            'guides/storage-and-memory',
            'guides/serving-over-http',
            'guides/command-line',
          ],
        },
        { label: 'Operate', items: ['guides/observability'] },
        { label: 'Cookbook', items: [{ autogenerate: { directory: 'cookbook' } }] },
        {
          label: 'Reference',
          items: [
            { label: 'API reference', link: '/api/', attrs: { target: '_self' } },
            {
              label: 'Threat model',
              link: 'https://github.com/intellibrix/intellibrix/blob/master/THREAT_MODEL.md',
            },
            {
              label: 'Migration from 0.x',
              link: 'https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md',
            },
          ],
        },
      ],
    }),
  ],
})
