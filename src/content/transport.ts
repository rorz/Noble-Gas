import { browser } from 'wxt/browser';
import { type RewriteOutput, rewriteOutputSchema, type Segment } from '../shared/contracts';

interface RewriteResult {
  output: RewriteOutput;
  motion: boolean;
}
export type RewriteTransport = (segments: Segment[], signal: AbortSignal) => Promise<RewriteResult>;

export const extensionTransport: RewriteTransport = (segments, signal) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const port = browser.runtime.connect({ name: 'noble-gas/rewrite' });
    let done = false;
    const keepAlive = setInterval(() => port.postMessage({ type: 'ping' }), 20_000);
    const timeout = setTimeout(
      () => finish(new Error('The rewrite timed out. Try a shorter passage.')),
      95_000,
    );
    const onAbort = () => {
      port.postMessage({ type: 'cancel' });
      finish(new DOMException('Stopped', 'AbortError'));
    };
    const finish = (error?: Error, result?: RewriteResult) => {
      if (done) return;
      done = true;
      clearInterval(keepAlive);
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      port.disconnect();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    port.onDisconnect.addListener(() =>
      finish(new Error('The extension reconnected. Select the text and try again.')),
    );
    port.onMessage.addListener((message) => {
      if (message?.type === 'error')
        finish(
          new Error(typeof message.error === 'string' ? message.error : 'The rewrite failed.'),
        );
      if (message?.type === 'result') {
        const parsed = rewriteOutputSchema.safeParse(message.output);
        if (!parsed.success)
          finish(new Error('The model returned an invalid passage. Your page is unchanged.'));
        else finish(undefined, { output: parsed.data, motion: message.motion === true });
      }
    });
    port.postMessage({ type: 'rewrite', requestId: crypto.randomUUID(), segments });
  });
