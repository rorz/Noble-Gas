import { type ControlMessage, type PublicSettings, settingsSchema } from '../shared/contracts';

export const inExtension = Boolean(
  (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id,
);

export async function send<T>(message: ControlMessage): Promise<T> {
  if (!inExtension) throw new Error('Open Noble Gas from the browser toolbar to use this control.');
  const { request } = await import('../shared/runtime');
  return request<T>(message);
}

export async function loadSettings(): Promise<PublicSettings> {
  return inExtension
    ? send({ type: 'get-settings' })
    : { ...settingsSchema.parse({}), hasKey: false, rememberKey: false };
}

export async function openChamber(): Promise<void> {
  if (inExtension) {
    const { browser } = await import('wxt/browser');
    await browser.tabs.create({ url: browser.runtime.getURL('/chamber.html') });
  } else window.open('/chamber.html', '_blank', 'noopener');
}

export async function openPopup(): Promise<void> {
  if (inExtension) await send({ type: 'open-popup' });
  else if (document.documentElement.hasAttribute('data-noble-gas-ready'))
    document.dispatchEvent(new Event('noble-gas:open-popup'));
  else window.open('/popup.html', '_blank', 'noopener');
}
