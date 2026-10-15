import { type RewriteOutput, rewriteOutputSchema, type Segment } from './contracts';

/** Only these application-authored messages may be shown after model validation. */
export class RewriteValidationError extends Error {}

/** Require a complete one-to-one reply before touching the document. */
export function validateRewrite(input: Segment[], output: unknown): RewriteOutput {
  const parsed = rewriteOutputSchema.safeParse(output);
  if (!parsed.success)
    throw new RewriteValidationError('Gemini returned an invalid rewrite. Your page is unchanged.');
  const result = parsed.data;
  const byId = new Map(result.segments.map((segment) => [segment.id, segment]));
  if (result.segments.length !== input.length || byId.size !== input.length) {
    throw new RewriteValidationError(
      'The model returned an incomplete passage. Your page is unchanged.',
    );
  }
  let total = 0;
  for (const segment of input) {
    const replacement = byId.get(segment.id);
    if (!replacement || (segment.locked && replacement.text !== segment.text)) {
      throw new RewriteValidationError('The model changed protected text. Your page is unchanged.');
    }
    if (!segment.locked) {
      const leading = segment.text.match(/^\s*/)?.[0] ?? '';
      const trailing = segment.text.match(/\s*$/)?.[0] ?? '';
      replacement.text = leading + replacement.text.trim() + trailing;
    }
    // Text is never interpreted as HTML, but markup in prose is still an invalid rewrite.
    if (/<\/?[a-z][^>]*>/i.test(replacement.text) && !/<\/?[a-z][^>]*>/i.test(segment.text)) {
      throw new RewriteValidationError(
        'The model returned markup instead of prose. Your page is unchanged.',
      );
    }
    total += replacement.text.length;
  }
  const originalLength = input.reduce((sum, segment) => sum + segment.text.length, 0);
  if (!result.segments.some((segment) => segment.text.trim()) || total > originalLength * 2 + 200) {
    throw new RewriteValidationError(
      'The rewrite was empty or unexpectedly long. Your page is unchanged.',
    );
  }
  for (const block of new Set(input.map((segment) => segment.block))) {
    const original = input.filter((segment) => segment.block === block);
    if (
      original.some((segment) => segment.text.trim()) &&
      !original.some((segment) => byId.get(segment.id)?.text.trim())
    ) {
      throw new RewriteValidationError(
        'The model removed an entire block. Your page is unchanged.',
      );
    }
  }
  return result;
}
