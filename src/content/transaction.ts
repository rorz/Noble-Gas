import { type RewriteOutput, rewriteOutputSchema } from '../shared/contracts';
import { validateRewrite } from '../shared/validation';
import type { Passage } from './selection';

interface Patch {
  node: Text;
  before: string;
  after: string;
  start: number;
  end: number;
  block: number;
}
export interface Transaction {
  patches: Patch[];
  url: string;
  beforeWords: number;
  afterWords: number;
}

function wordCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter(
    (part) => part.isWordLike,
  ).length;
}

function passageText(segments: { text: string; block?: number }[]): string {
  return segments
    .map((segment, index) => {
      const previous = segments[index - 1];
      return `${previous && previous.block !== segment.block ? '\n\n' : ''}${segment.text}`;
    })
    .join('');
}

/** Drafts are reversible text-only patches. The original tail stays under the
 * loading mask until commit, keeping the paragraph from collapsing mid-stream. */
export class RewriteSession {
  private patches: Patch[];
  private received = new Map<string, number>();
  private closed = false;

  constructor(private passage: Passage) {
    this.patches = passage.slices.map(({ node, before, start, end, segment }) => ({
      node,
      before,
      after: before,
      start,
      end,
      block: segment.block,
    }));
  }

  private assertCurrent(): void {
    if (
      this.closed ||
      location.href !== this.passage.url ||
      this.patches.some(({ node, after }) => !node.isConnected || node.data !== after)
    ) {
      throw new Error('The page changed while rewriting. Select the passage again.');
    }
  }

  preview(output: RewriteOutput): void {
    this.assertCurrent();
    const parsed = rewriteOutputSchema.safeParse(output);
    if (!parsed.success) throw new Error('Gemini returned an invalid rewrite.');
    const drafts = new Map(parsed.data.segments.map((segment) => [segment.id, segment.text]));
    const known = new Set(this.passage.segments.map((segment) => segment.id));
    if (drafts.size !== output.segments.length || [...drafts.keys()].some((id) => !known.has(id)))
      throw new Error('Gemini returned an invalid segment.');
    const originalLength = this.passage.segments.reduce(
      (sum, segment) => sum + segment.text.length,
      0,
    );
    if ([...drafts.values()].reduce((sum, text) => sum + text.length, 0) > originalLength * 2 + 200)
      throw new Error('The rewrite was unexpectedly long.');

    for (const [index, slice] of this.passage.slices.entries()) {
      const text = drafts.get(slice.segment.id);
      const patch = this.patches[index];
      if (!patch || text === undefined || !slice.segment.text.trim()) continue;
      const leading = slice.segment.text.match(/^\s*/)?.[0] ?? '';
      const trailing = slice.segment.text.match(/\s*$/)?.[0] ?? '';
      const draft = leading + text.trim() + trailing;
      this.received.set(slice.segment.id, draft.length);
      patch.after =
        slice.before.slice(0, slice.start) +
        draft +
        slice.segment.text.slice(draft.length) +
        slice.before.slice(slice.end);
      if (patch.node.data !== patch.after) patch.node.data = patch.after;
    }
  }

  selectionRange(): Range | undefined {
    const first = this.passage.slices[0];
    const last = this.passage.slices.at(-1);
    if (!first?.node.isConnected || !last?.node.isConnected) return;
    const range = document.createRange();
    range.setStart(first.node, Math.min(first.start, first.node.length));
    range.setEnd(last.node, Math.max(0, last.node.length - (last.before.length - last.end)));
    return range;
  }

  pendingRanges(): Range[] {
    return this.passage.slices.flatMap(({ node, start, before, end, segment }) => {
      if (!segment.text.trim() || !node.isConnected) return [];
      const received = this.received.get(segment.id) ?? 0;
      const from = start + received;
      const to = node.length - (before.length - end);
      if (from >= to) return [];
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      return [range];
    });
  }

  commit(output: RewriteOutput): Transaction {
    const validated = validateRewrite(this.passage.segments, output);
    this.assertCurrent();
    const replacements = new Map(validated.segments.map((segment) => [segment.id, segment.text]));
    for (const [index, { before, start, end, segment }] of this.passage.slices.entries()) {
      const patch = this.patches[index];
      if (!patch) continue;
      patch.after = before.slice(0, start) + replacements.get(segment.id) + before.slice(end);
      if (patch.node.data !== patch.after) patch.node.data = patch.after;
    }
    this.closed = true;
    return {
      patches: this.patches,
      url: this.passage.url,
      beforeWords: wordCount(passageText(this.passage.segments)),
      afterWords: wordCount(
        passageText(
          this.passage.segments.map((segment) => ({
            ...segment,
            text: replacements.get(segment.id) ?? segment.text,
          })),
        ),
      ),
    };
  }

  rollback(): void {
    if (this.closed) return;
    // Restore only our own writes; never overwrite a concurrent website update.
    for (const patch of this.patches) {
      if (patch.node.isConnected && patch.node.data === patch.after && patch.after !== patch.before)
        patch.node.data = patch.before;
    }
    this.closed = true;
  }
}

export function applyRewrite(passage: Passage, output: RewriteOutput): Transaction {
  return new RewriteSession(passage).commit(output);
}

function isCurrent(transaction: Transaction): boolean {
  return (
    location.href === transaction.url &&
    transaction.patches.every(({ node, after }) => node.isConnected && node.data === after)
  );
}

/** Rebuild ranges from text offsets; live DOM ranges collapse when text is replaced. */
export function rewrittenRanges(transaction: Transaction): Range[] {
  if (!isCurrent(transaction)) return [];
  const changed = new Set(
    transaction.patches.filter(({ before, after }) => before !== after).map(({ block }) => block),
  );
  const ranges = new Map<number, Range>();
  for (const patch of transaction.patches) {
    if (!changed.has(patch.block)) continue;
    let range = ranges.get(patch.block);
    if (!range) {
      range = document.createRange();
      range.setStart(patch.node, patch.start);
      ranges.set(patch.block, range);
    }
    range.setEnd(patch.node, patch.after.length - (patch.before.length - patch.end));
  }
  return [...ranges.values()];
}

export function undoRewrite(transaction: Transaction): void {
  if (!isCurrent(transaction)) {
    throw new Error(
      'The page has changed since this rewrite. Reload to recover the original page.',
    );
  }
  for (const patch of transaction.patches) patch.node.data = patch.before;
}
