import { browser } from 'wxt/browser';
import { type PublicSettings, type Settings, settingsSchema } from '../shared/contracts';

const SETTINGS_KEY = 'preferences';
const API_KEY = 'geminiKey';
const LEGACY_API_KEY = 'gatewayKey';

function savedKey(values: Record<string, unknown>): string {
  if (typeof values[API_KEY] === 'string' && values[API_KEY]) return values[API_KEY];
  const legacy = values[LEGACY_API_KEY];
  // Early builds labelled this field Gateway even when a Google key was entered.
  // Recognize both Google's standard keys and its newer authorization keys.
  return typeof legacy === 'string' && /^(AIza|AQ\.)/.test(legacy.trim()) ? legacy.trim() : '';
}

// A content script must never be able to read credentials, even through storage.local.
async function protectStorage(): Promise<void> {
  await Promise.all([
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
}

export async function readConfiguration(): Promise<{
  settings: Settings;
  apiKey: string;
  rememberKey: boolean;
}> {
  await protectStorage();
  const [local, session] = await Promise.all([
    browser.storage.local.get([SETTINGS_KEY, API_KEY, LEGACY_API_KEY]),
    browser.storage.session.get([API_KEY, LEGACY_API_KEY]),
  ]);
  const saved = settingsSchema.safeParse(local[SETTINGS_KEY] ?? {});
  const localKey = savedKey(local);
  const sessionKey = savedKey(session);
  return {
    settings: saved.success ? saved.data : settingsSchema.parse({}),
    apiKey: localKey || sessionKey,
    rememberKey: Boolean(localKey),
  };
}

export async function publicSettings(): Promise<PublicSettings> {
  const { settings, apiKey, rememberKey } = await readConfiguration();
  return { ...settings, hasKey: Boolean(apiKey), rememberKey };
}

export async function saveConfiguration(
  settings: Settings,
  suppliedKey: string | undefined,
  remember: boolean,
): Promise<PublicSettings> {
  const current = await readConfiguration();
  const apiKey = suppliedKey?.trim() || current.apiKey;
  if (apiKey && /\s/.test(apiKey))
    throw new Error('The key contains spaces. Please paste it again.');
  await browser.storage.local.set({ [SETTINGS_KEY]: settingsSchema.parse(settings) });
  if (remember) {
    await browser.storage.local.set({ [API_KEY]: apiKey });
    await browser.storage.session.remove(API_KEY);
  } else {
    await browser.storage.session.set({ [API_KEY]: apiKey });
    await browser.storage.local.remove(API_KEY);
  }
  await Promise.all([
    browser.storage.local.remove(LEGACY_API_KEY),
    browser.storage.session.remove(LEGACY_API_KEY),
  ]);
  return publicSettings();
}

export async function forgetKey(): Promise<PublicSettings> {
  await protectStorage();
  await Promise.all([
    browser.storage.local.remove([API_KEY, LEGACY_API_KEY]),
    browser.storage.session.remove([API_KEY, LEGACY_API_KEY]),
  ]);
  return publicSettings();
}
