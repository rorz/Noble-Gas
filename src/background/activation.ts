import { browser } from 'wxt/browser';
import type { Activation } from '../shared/contracts';

export async function activateTab(mode: Activation, specifiedTabId?: number): Promise<void> {
  const tabId =
    specifiedTabId ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) throw new Error('Open a webpage first.');
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/injector.js'] });
  } catch {
    throw new Error(
      'Open a regular webpage. Browser settings, extension stores, and PDF viewers cannot be edited.',
    );
  }
  const response = await browser.tabs.sendMessage(
    tabId,
    { type: 'ng:activate', mode },
    { frameId: 0 },
  );
  if (!response?.ok)
    throw new Error(response?.error || 'The page did not respond. Reload it and try again.');
}
