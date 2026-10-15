import { beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { capturePassage, passageForElement } from '../src/content/selection';
import { applyRewrite, undoRewrite } from '../src/content/transaction';

const testWindow = new Window({ url: 'https://example.test/article' });
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  location: testWindow.location,
  Node: testWindow.Node,
  NodeFilter: testWindow.NodeFilter,
  Element: testWindow.Element,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
});
beforeEach(() => {
  document.body.replaceChildren();
  testWindow.location.href = 'https://example.test/article';
});

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  document.body.append(p);
  return p;
}

describe('DOM transactions', () => {
  test('replaces only the selected substring and restores it exactly', () => {
    const p = paragraph('Before: very important words. After.');
    const node = p.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, node.data.indexOf(' After.'));
    const passage = capturePassage(range);
    const transaction = applyRewrite(passage, { segments: [{ id: 's0', text: 'useful words.' }] });
    expect(p.textContent).toBe('Before: useful words. After.');
    undoRewrite(transaction);
    expect(p.textContent).toBe('Before: very important words. After.');
  });

  test('preserves anchors, inline formatting, code, and event handlers', () => {
    const p = paragraph('It is important to read ');
    const a = document.createElement('a');
    a.href = '/guide';
    a.textContent = 'the guide';
    const code = document.createElement('code');
    code.textContent = 'bun run check';
    const strong = document.createElement('strong');
    strong.textContent = 'very carefully';
    p.append(
      a,
      document.createTextNode(' and run '),
      code,
      document.createTextNode(' '),
      strong,
      '.',
    );
    let clicked = 0;
    a.addEventListener('click', () => {
      clicked += 1;
    });
    const before = p.outerHTML;
    const passage = passageForElement(p);
    const transaction = applyRewrite(passage, {
      segments: passage.segments.map((segment) => ({
        id: segment.id,
        text:
          segment.text === 'It is important to read '
            ? 'Read'
            : segment.text === 'very carefully'
              ? 'carefully'
              : segment.text,
      })),
    });
    expect(p.textContent).toBe('Read the guide and run bun run check carefully.');
    expect(p.querySelector('a')).toBe(a);
    expect(p.querySelector('code')).toBe(code);
    expect(p.querySelector('strong')).toBe(strong);
    a.dispatchEvent(new testWindow.Event('click') as unknown as Event);
    expect(clicked).toBe(1);
    undoRewrite(transaction);
    expect(p.outerHTML).toBe(before);
  });

  test('skips code blocks, editors, scripts, hidden text, and controls', () => {
    const container = document.createElement('article');
    document.body.append(container);
    const prose = document.createElement('p');
    prose.textContent = 'This paragraph can be made clearer.';
    container.append(prose);
    for (const tag of ['pre', 'script', 'style', 'button', 'textarea']) {
      const el = document.createElement(tag);
      el.textContent = 'SECRET';
      container.append(el);
    }
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', '');
    editor.textContent = 'PRIVATE DRAFT';
    container.append(editor);
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    hidden.textContent = 'HIDDEN';
    container.append(hidden);
    const passage = passageForElement(container);
    expect(passage.segments.map((segment) => segment.text).join('')).toBe(prose.textContent ?? '');
  });

  test('keeps separate paragraph boundaries in a multi-block selection', () => {
    const first = paragraph('The first paragraph.');
    const second = paragraph('The second paragraph.');
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, 1);
    const passage = capturePassage(range);
    expect(passage.segments.map((segment) => segment.block)).toEqual([0, 1]);
  });

  test('rejects stale nodes atomically when the website changes during a request', () => {
    const p = paragraph('Original text.');
    const span = document.createElement('span');
    span.textContent = ' More text.';
    p.append(span);
    const passage = passageForElement(p);
    span.textContent = 'Website changed it.';
    expect(() =>
      applyRewrite(passage, {
        segments: passage.segments.map((s) => ({ id: s.id, text: 'Rewrite.' })),
      }),
    ).toThrow('page changed');
    expect(p.firstChild?.textContent).toBe('Original text.');
  });

  test('rejects changed URLs and does not overwrite page updates during undo', () => {
    const p = paragraph('Original text.');
    const passage = passageForElement(p);
    testWindow.location.href = 'https://example.test/another';
    expect(() => applyRewrite(passage, { segments: [{ id: 's0', text: 'New text.' }] })).toThrow(
      'page changed',
    );
    testWindow.location.href = passage.url;
    const transaction = applyRewrite(passage, { segments: [{ id: 's0', text: 'New text.' }] });
    (p.firstChild as Text).data = 'Live page update';
    expect(() => undoRewrite(transaction)).toThrow('page has changed');
    expect(p.textContent).toBe('Live page update');
  });
});
