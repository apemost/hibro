import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'en-US',
  title: 'Hibro',
  description: 'Documentation for the Hibro browser extension',
  base: '/hibro/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Features', link: '/features' },
      { text: 'Privacy', link: '/privacy' },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/apemost/hibro',
        ariaLabel: 'Hibro on GitHub',
      },
    ],
    sidebar: [
      {
        text: 'User guides',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Features', link: '/features' },
          { text: 'Provider setup', link: '/providers' },
          { text: 'Privacy policy', link: '/privacy' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
        ],
      },
      {
        text: 'More guides',
        items: [{ text: 'Hibro skills', link: '/skills' }],
      },
    ],
    search: {
      provider: 'local',
    },
  },
});
