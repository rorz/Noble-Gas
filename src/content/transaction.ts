import type { RewriteOutput } from '../shared/contracts';
import { validateRewrite } from '../shared/validation';
import type { Passage } from './selection';

interface Patch {
  node: Text;
  before: string;
  after: string;
}
export interface Transaction {
  patches: Patch[];
  url: string;
  beforeWords: number;
  afterWords: number;
}

export function wordCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter(
    (part) => part.isWordLike,
  ).length;
}

export function passageText(segments: { text: string; block?: number }[]): string {
  return segments
    .map((segment, index) => {
      const previous = segments[index - 1];
      return `${previous && previous.block !== segment.block ? '\n\n' : ''}${segment.text}`;
    })
    .join('');
}

export function applyRewrite(passage: Passage, output: RewriteOutput): Transaction {
  const validated = validateRewrite(passage.segments, output);
  const replacements = new Map(validated.segments.map((segment) => [segment.id, segment.text]));
  if (
    location.href !== passage.url ||
    passage.slices.some(({ node, before }) => !node.isConnected || node.data !== before)
  ) {
    throw new Error('The page changed while rewriting. Select the passage again.');
  }
  const patches = passage.slices.map(({ node, before, start, end, segment }) => ({
    node,
    before,
    after:
      before.slice(0, start) + (replacements.get(segment.id) ?? segment.text) + before.slice(end),
  }));
  // One synchronous transaction. No HTML parsing, wrapper elements, or replaced event handlers.
  for (const patch of patches) patch.node.data = patch.after;
  return {
    patches,
    url: passage.url,
    beforeWords: wordCount(passageText(passage.segments)),
    afterWords: wordCount(
      passageText(
        passage.segments.map((segment) => ({
          ...segment,
          text: replacements.get(segment.id) ?? segment.text,
        })),
      ),
    ),
  };
}

export function undoRewrite(transaction: Transaction): void {
  if (
    location.href !== transaction.url ||
    transaction.patches.some(({ node, after }) => !node.isConnected || node.data !== after)
  ) {
    throw new Error(
      'The page has changed since this rewrite. Reload to recover the original page.',
    );
  }
  for (const patch of transaction.patches) patch.node.data = patch.before;
}
