import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { activateTab } from '../src/background/activation';
import { modelError, rewriteWithGemini } from '../src/background/gemini';
import {
  forgetKey,
  publicSettings,
  readConfiguration,
  saveConfiguration,
} from '../src/background/settings';
import { controlMessageSchema, errorMessage, rewriteRequestSchema } from '../src/shared/contracts';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: 'noble-gas',
      title: 'De-slop with Noble Gas',
      contexts: ['page', 'selection'],
    });
    if (details.reason === 'install') await browser.action.openPopup();
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'noble-gas' || tab?.id === undefined) return;
    try {
      const settings = await publicSettings();
      if (!settings.hasKey) {
        await browser.action.openPopup();
        return;
      }
      // Selection currently runs in the main frame; never reuse its last target for an iframe.
      await activateTab(info.frameId ? 'pick' : 'context', tab.id);
    } catch {
      // A page may have navigated or disallowed injection after the menu opened.
      await browser.action.openPopup();
    }
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'pick-text') return;
    try {
      const settings = await publicSettings();
      if (!settings.hasKey) {
        await browser.action.openPopup();
        return;
      }
      await activateTab('auto');
    } catch {
      await browser.action.openPopup();
    }
  });

  browser.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== browser.runtime.id) return false;
    const parsed = controlMessageSchema.safeParse(raw);
    if (!parsed.success) return false;
    const message = parsed.data;
    // Only our popup may read settings, configure keys, or activate tabs.
    if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
    const handle = async () => {
      switch (message.type) {
        case 'get-settings':
          return publicSettings();
        case 'save-settings':
          return saveConfiguration(message.settings, message.apiKey, message.rememberKey);
        case 'forget-key':
          return forgetKey();
        case 'activate': {
          const settings = await publicSettings();
          if (!settings.hasKey && message.mode !== 'undo')
            throw new Error('Open Noble Gas and set your Gemini API key first.');
          await activateTab(message.mode);
          return undefined;
        }
      }
    };
    void handle().then(
      (data) => respond({ ok: true, data }),
      (error: unknown) => respond({ ok: false, error: errorMessage(error) }),
    );
    return true;
  });

  browser.runtime.onConnect.addListener((port) => {
    if (
      port.name !== 'noble-gas/rewrite' ||
      port.sender?.id !== browser.runtime.id ||
      port.sender.tab?.id === undefined
    ) {
      port.disconnect();
      return;
    }
    // Chrome supplies the URL of the document that opened this rewrite's connection.
    const pageUrl = port.sender.url ?? port.sender.tab.url ?? '';
    const abort = new AbortController();
    let started = false;
    let disconnected = false;
    const timeout = setTimeout(() => abort.abort(), 90_000);
    port.onDisconnect.addListener(() => {
      disconnected = true;
      abort.abort();
      clearTimeout(timeout);
    });
    port.onMessage.addListener((raw) => {
      if (raw?.type === 'cancel') {
        abort.abort();
        return;
      }
      if (raw?.type === 'ping' || started) return;
      const parsed = rewriteRequestSchema.safeParse(raw);
      if (!parsed.success) {
        port.postMessage({
          type: 'error',
          error: 'This selection is too large or contains no editable prose.',
        });
        return;
      }
      started = true;
      const run = async () => {
        const { apiKey, settings } = await readConfiguration();
        const output = await rewriteWithGemini(
          parsed.data.segments,
          pageUrl,
          apiKey,
          settings,
          abort.signal,
          (output) => {
            if (!disconnected) port.postMessage({ type: 'progress', output });
          },
        );
        if (!disconnected) port.postMessage({ type: 'result', output, motion: settings.motion });
      };
      void run()
        .catch((error: unknown) => {
          if (!disconnected)
            port.postMessage({ type: 'error', error: modelError(error, abort.signal.aborted) });
        })
        .finally(() => clearTimeout(timeout));
    });
  });
});
