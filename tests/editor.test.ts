import { beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { capturePassage, passageForElement } from '../src/content/selection';
import {
  applyRewrite,
  RewriteSession,
  rewrittenRanges,
  toggleRewrite,
  undoRewrite,
} from '../src/content/transaction';

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
  test('anchors changed blocks and restores older markers after an overlapping undo', () => {
    const first = paragraph('Before: very important words. After.');
    const second = paragraph('Keep this paragraph.');
    const third = paragraph('This is another very long paragraph.');
    const range = document.createRange();
    range.setStart(first.firstChild as Text, 8);
    range.setEnd(third.firstChild as Text, third.textContent?.length ?? 0);
    const passage = capturePassage(range);
    const transaction = applyRewrite(passage, {
      segments: passage.segments.map((segment) => ({
        id: segment.id,
        text:
          segment.block === 0
            ? 'useful words. After.'
            : segment.block === 2
              ? 'Brief.'
              : segment.text,
      })),
    });
    expect(rewrittenRanges(transaction).map((part) => part.toString())).toEqual([
      'useful words. After.',
      'Brief.',
    ]);
    expect(second.textContent).toBe('Keep this paragraph.');
    const later = applyRewrite(passageForElement(third), {
      segments: [{ id: 's0', text: 'Short.' }],
    });
    expect(rewrittenRanges(transaction)).toEqual([]);
    undoRewrite(later);
    expect(rewrittenRanges(transaction).map((part) => part.toString())).toEqual([
      'useful words. After.',
      'Brief.',
    ]);
    first.remove();
    expect(rewrittenRanges(transaction)).toEqual([]);
  });

  test('streams a selected substring in place, masks its remaining tail, and undoes the final edit', () => {
    const p = paragraph('Before: very important words. After.');
    const node = p.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, node.data.indexOf(' After.'));
    const session = new RewriteSession(capturePassage(range));
    session.preview({ segments: [{ id: 's0', text: 'use' }] });
    expect(p.firstChild).toBe(node);
    expect(p.textContent).toBe('Before: usey important words. After.');
    expect(session.pendingRanges().map((part) => part.toString())).toEqual(['y important words.']);
    expect(session.selectionRange()?.toString()).toBe('usey important words.');
    session.preview({ segments: [{ id: 's0', text: 'useful words.' }] });
    const transaction = session.commit({ segments: [{ id: 's0', text: 'useful words.' }] });
    expect(p.textContent).toBe('Before: useful words. After.');
    undoRewrite(transaction);
    expect(p.textContent).toBe('Before: very important words. After.');
  });

  test('rolls streamed drafts back on cancellation or invalid final output', () => {
    const p = paragraph('Original text to rewrite.');
    const session = new RewriteSession(passageForElement(p));
    session.preview({ segments: [{ id: 's0', text: 'A draft' }] });
    expect(p.textContent).toStartWith('A draft');
    expect(() => session.commit({ segments: [] })).toThrow();
    session.rollback();
    expect(p.textContent).toBe('Original text to rewrite.');
    expect(() => session.preview({ segments: [{ id: 's0', text: 'Late chunk' }] })).toThrow();
  });

  test('streams link text and preserves concurrent page updates on rollback', () => {
    const p = paragraph('It is important to read ');
    const a = document.createElement('a');
    a.href = '/guide';
    a.textContent = 'the guide';
    const tail = document.createTextNode(' very carefully.');
    p.append(a, tail);
    const passage = passageForElement(p);
    const session = new RewriteSession(passage);
    session.preview({
      segments: [
        { id: 's0', text: 'Read' },
        { id: 's1', text: 'documentation' },
        { id: 's2', text: ' carefully.' },
      ],
    });
    expect(a.textContent).toBe('documentation');
    expect(a.getAttribute('href')).toBe('/guide');
    expect(p.querySelector('a')).toBe(a);
    tail.data = ' Website changed this.';
    expect(() => session.preview({ segments: [{ id: 's0', text: 'Read more' }] })).toThrow(
      'page changed',
    );
    session.rollback();
    expect(p.firstChild?.textContent).toBe('It is important to read ');
    expect(a.textContent).toBe('the guide');
    expect(tail.data).toBe(' Website changed this.');
  });

  test('switches only the selected substring and keeps its outline on the visible version', () => {
    const p = paragraph('Before: very important words. After.');
    const node = p.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, node.data.indexOf(' After.'));
    const passage = capturePassage(range);
    const transaction = applyRewrite(passage, { segments: [{ id: 's0', text: 'useful words.' }] });
    expect(p.textContent).toBe('Before: useful words. After.');
    for (let index = 0; index < 3; index += 1) {
      toggleRewrite(transaction);
      expect(transaction.view).toBe('original');
      expect(p.textContent).toBe('Before: very important words. After.');
      expect(rewrittenRanges(transaction).map((part) => part.toString())).toEqual([
        'very important words.',
      ]);
      toggleRewrite(transaction);
      expect(transaction.view).toBe('rewritten');
      expect(p.textContent).toBe('Before: useful words. After.');
      expect(rewrittenRanges(transaction).map((part) => part.toString())).toEqual([
        'useful words.',
      ]);
      expect(p.firstChild).toBe(node);
    }
    undoRewrite(transaction);
    expect(p.textContent).toBe('Before: very important words. After.');
  });

  test('rewrites inline text while preserving elements, link destinations, event handlers, and undo', () => {
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
    const replacements = new Map([
      ['It is important to read ', 'Read'],
      ['the guide', 'the documentation'],
      ['bun run check', 'bun check'],
      ['very carefully', 'carefully'],
    ]);
    const transaction = applyRewrite(passage, {
      segments: passage.segments.map((segment) => ({
        id: segment.id,
        text: replacements.get(segment.text) ?? segment.text,
      })),
    });
    expect(p.textContent).toBe('Read the documentation and run bun check carefully.');
    toggleRewrite(transaction);
    expect(p.outerHTML).toBe(before);
    toggleRewrite(transaction);
    expect(p.textContent).toBe('Read the documentation and run bun check carefully.');
    expect(p.querySelector('a')).toBe(a);
    expect(a.getAttribute('href')).toBe('/guide');
    expect(p.querySelector('code')).toBe(code);
    expect(p.querySelector('strong')).toBe(strong);
    a.dispatchEvent(new testWindow.Event('click') as unknown as Event);
    expect(clicked).toBe(1);
    undoRewrite(transaction);
    expect(p.outerHTML).toBe(before);
  });

  test('allows selections consisting entirely of link, code, or citation text', () => {
    for (const tag of ['a', 'code', 'kbd', 'samp', 'var', 'sup']) {
      const p = paragraph('');
      const inline = document.createElement(tag);
      inline.textContent = 'Original inline text';
      p.append(inline);
      const passage = passageForElement(inline);
      const session = new RewriteSession(passage);
      expect(session.pendingRanges().map((range) => range.toString())).toEqual([
        'Original inline text',
      ]);
      session.preview({ segments: [{ id: 's0', text: 'Clear' }] });
      expect(inline.textContent).toStartWith('Clear');
      const transaction = session.commit({ segments: [{ id: 's0', text: 'Clear text' }] });
      expect(inline.textContent).toBe('Clear text');
      undoRewrite(transaction);
      expect(inline.textContent).toBe('Original inline text');
    }
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

  test.each(['original', 'rewritten'] as const)(
    'refuses to switch the %s version after navigation or a live page update',
    (view) => {
      const p = paragraph('Original text.');
      const span = document.createElement('span');
      span.textContent = ' More details.';
      p.append(span);
      const passage = passageForElement(p);
      const transaction = applyRewrite(passage, {
        segments: passage.segments.map(({ id }) => ({ id, text: 'Rewritten.' })),
      });
      if (view === 'original') toggleRewrite(transaction);
      const visible = p.textContent;
      testWindow.location.href = 'https://example.test/another';
      expect(() => toggleRewrite(transaction)).toThrow('page has changed');
      expect(p.textContent).toBe(visible);
      testWindow.location.href = passage.url;
      const first = p.firstChild?.textContent;
      (span.firstChild as Text).data = ' Live page update';
      expect(() => toggleRewrite(transaction)).toThrow('page has changed');
      expect(() => undoRewrite(transaction)).toThrow('page has changed');
      expect(p.firstChild?.textContent).toBe(first);
      expect(span.textContent).toBe(' Live page update');
      expect(transaction.view).toBe(view);
      expect(rewrittenRanges(transaction)).toEqual([]);
    },
  );
});
