import { browser } from 'wxt/browser';
import { activationSchema } from '../shared/contracts';
import { PageController } from './controller';
import { extensionTransport } from './transport';

export function boot(): void {
  const scope = globalThis as typeof globalThis & { __nobleGas?: PageController };
  if (scope.__nobleGas) return;
  const controller = new PageController(extensionTransport);
  scope.__nobleGas = controller;
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== browser.runtime.id || message?.type !== 'ng:activate') return false;
    const mode = activationSchema.safeParse(message.mode);
    if (!mode.success) return false;
    controller.activate(mode.data);
    respond({ ok: true });
    return false;
  });
}
