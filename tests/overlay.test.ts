import { afterEach, beforeEach, expect, jest, mock, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { PageController } from '../src/content/controller';
import { Overlay } from '../src/content/overlay';
import type { RewriteTransport } from '../src/content/transport';

const testWindow = new Window({ url: 'https://example.test/article' });
let shadow: ShadowRoot;

beforeEach(() => {
  testWindow.document.body.replaceChildren();
  testWindow.getSelection().removeAllRanges();
  Object.assign(globalThis, {
    window: testWindow,
    document: testWindow.document,
    location: testWindow.location,
    Node: testWindow.Node,
    NodeFilter: testWindow.NodeFilter,
    Element: testWindow.Element,
    getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
    MutationObserver: testWindow.MutationObserver,
    ResizeObserver: testWindow.ResizeObserver,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
    cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
  });
  const attach = testWindow.HTMLElement.prototype.attachShadow;
  spyOn(testWindow.HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: InstanceType<typeof testWindow.HTMLElement>,
    init,
  ) {
    const root = attach.call(this, init);
    shadow = root as unknown as ShadowRoot;
    return root;
  });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  mock.restore();
  document.querySelector('noble-gas-ui')?.remove();
});

test('hiding the loading bar keeps the rewrite chip and its undo action', () => {
  const ui = new Overlay();
  const undo = mock(() => {});
  const remove = ui.markRewrite(() => [], 12, undo);
  ui.show('Rewriting…');
  const bar = shadow.querySelector<HTMLElement>('.bar');
  expect(bar?.hidden).toBe(false);
  ui.hide();
  expect(bar?.hidden).toBe(true);
  expect(document.querySelector('noble-gas-ui')).not.toBeNull();
  expect(shadow.querySelector('.rewrite-chip')?.textContent).toContain('12 words removed');
  shadow.querySelector<HTMLButtonElement>('.rewrite-chip button')?.click();
  expect(undo).toHaveBeenCalledTimes(1);
  remove();
  expect(document.querySelector('noble-gas-ui')).toBeNull();
});

test('shows loading, then finishes and undoes without a completion message', async () => {
  const p = document.createElement('p');
  const original = 'This is a very wordy paragraph.';
  p.textContent = original;
  document.body.append(p);
  const range = document.createRange();
  range.selectNodeContents(p);
  window.getSelection()?.addRange(range);
  const reply = Promise.withResolvers<Awaited<ReturnType<RewriteTransport>>>();
  const controller = new PageController(() => reply.promise);
  controller.activate('selection');
  jest.advanceTimersByTime(5_000);
  expect(shadow.querySelector<HTMLElement>('.bar')?.hidden).toBe(false);
  expect(shadow.querySelector('.message')?.textContent).toBe('Rewriting…');
  reply.resolve({
    output: { segments: [{ id: 's0', text: 'A short paragraph.' }] },
    motion: false,
  });
  await Promise.resolve();
  expect(p.textContent).toBe('A short paragraph.');
  expect(shadow.querySelector<HTMLElement>('.bar')?.hidden).toBe(true);
  expect(shadow.querySelector('.rewrite-chip')).not.toBeNull();
  shadow.querySelector<HTMLButtonElement>('.rewrite-chip button')?.click();
  expect(p.textContent).toBe(original);
  expect(document.querySelector('noble-gas-ui')).toBeNull();
});

test('right-click rewrites the clicked passage, with highlighted text taking precedence', async () => {
  const first = document.createElement('p');
  first.textContent = 'This is the paragraph that was right-clicked.';
  const second = document.createElement('p');
  second.textContent = 'This is a different selected passage.';
  document.body.append(first, second);
  const transport = mock<RewriteTransport>(async (segments) => ({
    output: { segments: segments.map(({ id, text }) => ({ id, text })) },
    motion: false,
  }));
  const controller = new PageController(transport);
  first.dispatchEvent(
    new testWindow.MouseEvent('contextmenu', { bubbles: true }) as unknown as MouseEvent,
  );
  controller.activate('context');
  expect(transport.mock.calls[0]?.[0].map(({ text }) => text).join('')).toBe(first.textContent);
  await Promise.resolve();

  const range = document.createRange();
  range.selectNodeContents(second);
  window.getSelection()?.addRange(range);
  first.dispatchEvent(
    new testWindow.MouseEvent('contextmenu', { bubbles: true }) as unknown as MouseEvent,
  );
  controller.activate('context');
  expect(transport.mock.calls[1]?.[0].map(({ text }) => text).join('')).toBe(second.textContent);
  await Promise.resolve();
  expect(shadow.querySelector<HTMLElement>('.bar')?.hidden).toBe(true);
});
