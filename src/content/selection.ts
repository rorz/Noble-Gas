import { MAX_CHARACTERS, MAX_SEGMENTS, type Segment } from '../shared/contracts';

const EXCLUDED =
  'script, style, noscript, textarea, input, select, option, button, pre, svg, math, [hidden], [aria-hidden="true"], [role="textbox"], [data-noble-gas]';
const PROTECTED = 'a, code, kbd, samp, var, sup, .katex, .MathJax';
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, dd, dt, figcaption';

interface TextSlice {
  node: Text;
  before: string;
  start: number;
  end: number;
  segment: Segment;
}

export interface Passage {
  slices: TextSlice[];
  segments: Segment[];
  range: Range;
  url: string;
}

function isExcluded(element: Element): boolean {
  if (element.closest(EXCLUDED)) return true;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const editable = current.getAttribute('contenteditable');
    if (editable !== null && editable !== 'false') return true;
    const style = getComputedStyle(current);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return true;
  }
  return false;
}

export function capturePassage(range: Range): Passage {
  if (range.collapsed || !range.toString().trim())
    throw new Error('Highlight a passage of text first.');
  if (range.toString().length > MAX_CHARACTERS)
    throw new Error('Choose a smaller passage (up to 18,000 characters).');
  const ancestor = range.commonAncestorContainer;
  const root = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor;
  if (!root || root.getRootNode() !== document)
    throw new Error('This text is inside a component Noble Gas cannot edit.');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const slices: TextSlice[] = [];
  const blocks = new Map<Element, number>();
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const parent = text.parentElement;
    if (parent && range.intersectsNode(text) && !isExcluded(parent)) {
      const start = range.startContainer === text ? range.startOffset : 0;
      const end = range.endContainer === text ? range.endOffset : text.length;
      const selected = text.data.slice(start, end);
      if (selected) {
        const block =
          parent.closest(BLOCKS) ?? parent.closest('div, article, section, main') ?? parent;
        if (!blocks.has(block)) blocks.set(block, blocks.size);
        const segment: Segment = {
          id: `s${slices.length}`,
          block: blocks.get(block) ?? 0,
          text: selected,
          locked: Boolean(parent.closest(PROTECTED)) || !selected.trim(),
        };
        slices.push({ node: text, before: text.data, start, end, segment });
      }
    }
    if (slices.length > MAX_SEGMENTS)
      throw new Error('That passage has too many formatting boundaries. Select a little less.');
    node = walker.nextNode();
  }
  if (!slices.some(({ segment }) => !segment.locked)) {
    throw new Error('Choose prose outside code blocks, links, and text editors.');
  }
  return {
    slices,
    segments: slices.map(({ segment }) => segment),
    range: range.cloneRange(),
    url: location.href,
  };
}

export function selectedPassage(): Passage {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0)
    throw new Error('Highlight a passage of text first.');
  return capturePassage(selection.getRangeAt(0));
}

export function passageForElement(element: Element): Passage {
  const range = document.createRange();
  range.selectNodeContents(element);
  return capturePassage(range);
}

export function pickableBlock(target: EventTarget | null): Element | null {
  if (!(target instanceof Element) || isExcluded(target)) return null;
  if (target.closest('a, [role="button"], [role="link"]')) return null;
  const block = target.closest(BLOCKS);
  if (block && (block.textContent?.trim().length ?? 0) >= 12) return block;
  for (
    let element: Element | null = target;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const length = element.textContent?.trim().length ?? 0;
    if (length > MAX_CHARACTERS) return null;
    if (length >= 24 && element.matches('div, article, section')) return element;
  }
  return null;
}
