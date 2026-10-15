import { defineConfig } from 'wxt';

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  dev: { server: { port: 3000 } },
  webExt: {
    binaries: process.env.NOBLE_GAS_BROWSER ? { chrome: process.env.NOBLE_GAS_BROWSER } : {},
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data', '--no-first-run'],
    startUrls: ['http://localhost:3000/entrypoints/chamber/index.html'],
  },
  manifest: ({ command }) => ({
    name: 'Noble Gas',
    description: 'Less noise. Same substance. Select text, remove the slop, keep the page.',
    minimum_chrome_version: '127',
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    commands: {
      'pick-text': {
        suggested_key: { default: 'Alt+Shift+N', mac: 'Alt+Shift+N' },
        description: 'Pick a block to de-slop, or rewrite selected text',
      },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com" +
        (command === 'serve' ? ' http://localhost:3000 ws://localhost:3000' : ''),
    },
  }),
});
