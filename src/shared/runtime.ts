import { browser } from 'wxt/browser';
import type { ControlMessage, Reply } from './contracts';

export async function request<T>(message: ControlMessage): Promise<T> {
  const reply = (await browser.runtime.sendMessage(message)) as Reply<T> | undefined;
  if (!reply) throw new Error('Noble Gas is reconnecting. Reopen the extension and try again.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
