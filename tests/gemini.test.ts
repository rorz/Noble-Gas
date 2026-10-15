import { expect, spyOn, test } from 'bun:test';
import { APICallError } from 'ai';
import { modelError, rewriteWithGemini } from '../src/background/gemini';
import { type RewriteOutput, settingsSchema } from '../src/shared/contracts';

const pageUrl = 'https://github.com/example/project/pull/42?tab=conversation#issuecomment-123';

test('emits partial prose before the Google response finishes', async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const chunk = (text: string, finished = false) =>
    encoder.encode(
      `data: ${JSON.stringify({
        candidates: [
          {
            content: { role: 'model', parts: [{ text }] },
            ...(finished ? { finishReason: 'STOP' } : {}),
          },
        ],
      })}\n\n`,
    );
  const fakeFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
          controller.enqueue(chunk('{"segments":[{"id":"s0","text":"Clear'));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  );
  try {
    const first = Promise.withResolvers<RewriteOutput>();
    let finished = false;
    const rewrite = rewriteWithGemini(
      [{ id: 's0', block: 0, text: 'It is worth noting this prose.' }],
      pageUrl,
      'test-only-dummy-key',
      settingsSchema.parse({}),
      new AbortController().signal,
      (output) => first.resolve(output),
    ).then((output) => {
      finished = true;
      return output;
    });
    expect((await first.promise).segments).toEqual([{ id: 's0', text: 'Clear' }]);
    expect(finished).toBe(false);
    stream?.enqueue(chunk(' prose."}]}', true));
    stream?.close();
    expect(await rewrite).toEqual({ segments: [{ id: 's0', text: 'Clear prose.' }] });
  } finally {
    fakeFetch.mockRestore();
  }
});

test.each([
  {},
  { thinkingLevel: 'medium', webSearch: false },
  { thinkingLevel: 'high', webSearch: true },
])('sends the page URL and saved thinking/search settings: %j', async (preferences) => {
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
    const segments = [{ id: 's0', block: 0, text: 'It is worth noting this prose.' }];
    const settings = settingsSchema.parse(preferences);
    const result = await rewriteWithGemini(
      segments,
      pageUrl,
      'test-only-dummy-key',
      settings,
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
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe(settings.thinkingLevel);
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({ pageUrl, segments });
    if (settings.webSearch) expect(body.tools).toEqual([{ googleSearch: {} }]);
    else expect(body.tools).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBe('application/json');
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
          [{ id: 's0', block: 0, text: 'A paragraph to edit.' }],
          pageUrl,
          'test-only-dummy-key',
          settingsSchema.parse({}),
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
