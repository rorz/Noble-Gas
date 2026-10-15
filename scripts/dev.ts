import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  Browser,
  ChromeReleaseChannel,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
} from '@puppeteer/browsers';

const cacheDir = join(homedir(), '.cache', 'puppeteer');
const installed = (await getInstalledBrowsers({ cacheDir }))
  .filter((browser) => browser.browser === Browser.CHROME)
  .sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));
let chrome = installed[0];
if (!chrome) {
  console.info('Noble Gas: downloading Chrome for Testing (once).');
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Chrome for Testing is not available on this platform.');
  const buildId = await resolveBuildId(Browser.CHROME, platform, ChromeReleaseChannel.STABLE);
  chrome = await install({ browser: Browser.CHROME, buildId, cacheDir });
}
console.info(
  `Noble Gas: Chrome for Testing ${chrome.buildId}. Opens automatically with the extension loaded.`,
);
const child = Bun.spawn(['bun', 'run', 'wxt'], {
  env: { ...process.env, NOBLE_GAS_BROWSER: chrome.executablePath },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
