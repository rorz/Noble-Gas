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
