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

test('closing or expiring a toast keeps the rewrite chip and its undo action', () => {
  const ui = new Overlay();
  const undo = mock(() => {});
  const remove = ui.markRewrite(() => [], 12, undo);
  ui.toast('Rewrite complete.');
  const bar = shadow.querySelector<HTMLElement>('.bar');
  jest.advanceTimersByTime(4_999);
  expect(bar?.hidden).toBe(false);
  jest.advanceTimersByTime(1);
  expect(bar?.hidden).toBe(true);
  expect(document.querySelector('noble-gas-ui')).not.toBeNull();
  expect(shadow.querySelector('.rewrite-chip')?.textContent).toContain('12 words removed');
  shadow.querySelector<HTMLButtonElement>('.rewrite-chip button')?.click();
  expect(undo).toHaveBeenCalledTimes(1);
  ui.toast('Rewrite complete.');
  shadow.querySelector<HTMLButtonElement>('.actions button')?.click();
  expect(bar?.hidden).toBe(true);
  expect(shadow.querySelector('.rewrite-chip')).not.toBeNull();
  remove();
  expect(document.querySelector('noble-gas-ui')).toBeNull();
});

test('a previous toast cannot dismiss the next rewrite', () => {
  const ui = new Overlay();
  ui.toast('Rewrite complete.');
  jest.advanceTimersByTime(4_000);
  ui.show('Rewriting…', [], true);
  jest.advanceTimersByTime(1_000);
  expect(shadow.querySelector<HTMLElement>('.bar')?.hidden).toBe(false);
  expect(shadow.querySelector('.message')?.textContent).toBe('Rewriting…');
  ui.hide();
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
  jest.advanceTimersByTime(5_000);
});
