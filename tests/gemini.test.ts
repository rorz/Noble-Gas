import { expect, spyOn, test } from 'bun:test';
import { APICallError } from 'ai';
import { modelError, rewriteWithGemini } from '../src/background/gemini';
import { settingsSchema } from '../src/shared/contracts';

test('the real SDK sends the Gemini key directly to Google and parses structured streaming output', async () => {
  const output = { segments: [{ id: 's0', text: 'Clear prose.' }] };
  const event = {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: JSON.stringify(output) }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
  };
  const fakeFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(`data: ${JSON.stringify(event)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
  try {
    const segments = [
      { id: 's0', block: 0, text: 'It is worth noting this prose.', locked: false },
    ];
    const result = await rewriteWithGemini(
      segments,
      settingsSchema.parse({}),
      'test-only-dummy-key',
      new AbortController().signal,
    );
    expect(result).toEqual(output);
    const calls = fakeFetch.mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toStartWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent',
    );
    expect(new Headers(calls[0]?.[1]?.headers).get('x-goog-api-key')).toBe('test-only-dummy-key');
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(segments);
    // Google accepts the shape, but rejects maxItems: 160 even for one segment.
    expect(body.generationConfig.responseJsonSchema.properties.segments.minItems).toBe(1);
    expect(body.generationConfig.responseJsonSchema.properties.segments).not.toHaveProperty(
      'maxItems',
    );
  } finally {
    fakeFetch.mockRestore();
  }
});

test('provider errors do not expose request bodies or credentials', () => {
  for (const statusCode of [401, 402, 403, 404, 429, 500]) {
    const error = new APICallError({
      message: 'secret-api-key private selected text',
      url: 'https://generativelanguage.googleapis.com',
      statusCode,
      requestBodyValues: { key: 'secret-api-key' },
      responseBody: 'private selected text',
    });
    const message = modelError(error, false);
    expect(message).not.toContain('secret-api-key');
    expect(message).not.toContain('private selected text');
  }
  expect(modelError(new Error('anything'), true)).toContain('stopped');
});

test('streaming HTTP failures preserve the actionable Google error instead of losing it', async () => {
  for (const [status, expected] of [
    [400, 'API key'],
    [403, 'denied access'],
    [404, 'unavailable'],
    [429, 'quota'],
  ] as const) {
    const fakeFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            code: status,
            status: 'INVALID_ARGUMENT',
            message: 'API_KEY_INVALID private selected text secret-api-key',
          },
        },
        { status },
      ),
    );
    try {
      let failure: unknown;
      try {
        await rewriteWithGemini(
          [{ id: 's0', block: 0, text: 'A paragraph to edit.', locked: false }],
          settingsSchema.parse({}),
          'test-only-dummy-key',
          new AbortController().signal,
        );
      } catch (error) {
        failure = error;
      }
      expect(APICallError.isInstance(failure)).toBe(true);
      expect(modelError(failure, false)).toContain(expected);
      expect(modelError(failure, false)).not.toContain('private selected text');
      expect(modelError(failure, false)).not.toContain('secret-api-key');
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    } finally {
      fakeFetch.mockRestore();
    }
  }
});
