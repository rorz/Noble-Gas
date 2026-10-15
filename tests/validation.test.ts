import { describe, expect, test } from 'bun:test';
import { MAX_SEGMENTS, rewriteRequestSchema, type Segment } from '../src/shared/contracts';
import { validateRewrite } from '../src/shared/validation';

const input: Segment[] = [
  { id: 's0', block: 0, text: '  Explore the ', locked: false },
  { id: 's1', block: 0, text: 'documentation', locked: true },
  { id: 's2', block: 1, text: 'The cache lasts 60 seconds.', locked: false },
];
const output = () => ({ segments: input.map(({ id, text }) => ({ id, text })) });

describe('model output checks', () => {
  test('enforces the segment cap locally even though the provider schema omits it', () => {
    const segments = Array.from({ length: MAX_SEGMENTS }, (_, i) => ({
      id: `s${i}`,
      block: 0,
      text: 'Clear prose.',
      locked: false,
    }));
    expect(validateRewrite(segments, { segments }).segments).toHaveLength(MAX_SEGMENTS);
    const tooMany = [...segments, { ...segments[0], id: `s${MAX_SEGMENTS}` }];
    expect(() => validateRewrite(segments, { segments: tooMany })).toThrow('invalid rewrite');
  });
  test('restores boundary whitespace so inline words cannot run together', () => {
    const candidate = output();
    candidate.segments[0] = { id: 's0', text: 'Read' };
    expect(validateRewrite(input, candidate).segments[0]?.text).toBe('  Read ');
  });
  test('rejects missing, duplicate, and foreign IDs', () => {
    expect(() => validateRewrite(input, { segments: output().segments.slice(1) })).toThrow();
    const duplicate = output();
    duplicate.segments[1] = { id: 's0', text: 'documentation' };
    expect(() => validateRewrite(input, duplicate)).toThrow();
    const foreign = output();
    foreign.segments[0] = { id: 's99', text: 'Read ' };
    expect(() => validateRewrite(input, foreign)).toThrow();
  });
  test('rejects changes to protected links and code', () => {
    const candidate = output();
    candidate.segments[1] = { id: 's1', text: 'click here' };
    expect(() => validateRewrite(input, candidate)).toThrow('protected');
  });
  test('rejects injected markup, excessive output, and erased paragraphs', () => {
    const candidate = output();
    candidate.segments[0] = { id: 's0', text: '<img src=x onerror=alert(1)>' };
    expect(() => validateRewrite(input, candidate)).toThrow('markup');
    candidate.segments[0] = { id: 's0', text: 'x'.repeat(1000) };
    expect(() => validateRewrite(input, candidate)).toThrow('long');
    candidate.segments[0] = { id: 's0', text: 'Read ' };
    candidate.segments[2] = { id: 's2', text: '' };
    expect(() => validateRewrite(input, candidate)).toThrow('block');
  });
  test('bounds requests and requires editable prose', () => {
    const request = { type: 'rewrite', requestId: crypto.randomUUID(), segments: input };
    expect(rewriteRequestSchema.safeParse(request).success).toBe(true);
    expect(
      rewriteRequestSchema.safeParse({
        ...request,
        segments: input.map((segment) => ({ ...segment, locked: true })),
      }).success,
    ).toBe(false);
    expect(
      rewriteRequestSchema.safeParse({
        ...request,
        segments: [{ ...input[0], text: 'x'.repeat(18_001) }],
      }).success,
    ).toBe(false);
  });
});
