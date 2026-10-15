import { z } from 'zod';

export const MAX_CHARACTERS = 18_000;
export const MAX_SEGMENTS = 160;
const DEFAULT_MODEL = 'gemini-4-argon';

const strengthSchema = z.enum(['light', 'balanced', 'thorough']);
export type Strength = z.infer<typeof strengthSchema>;

export const settingsSchema = z.object({
  model: z.enum([DEFAULT_MODEL, 'gemini-3.5-flash-lite']).default(DEFAULT_MODEL),
  strength: strengthSchema.default('balanced'),
  motion: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export type PublicSettings = Settings & { hasKey: boolean; rememberKey: boolean };

const segmentSchema = z.object({
  id: z.string().regex(/^s\d+$/),
  block: z.number().int().nonnegative(),
  text: z.string().min(1).max(MAX_CHARACTERS),
  locked: z.boolean(),
});
export type Segment = z.infer<typeof segmentSchema>;

export const rewriteRequestSchema = z
  .object({
    type: z.literal('rewrite'),
    requestId: z.string().uuid(),
    segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
  })
  .superRefine(({ segments }, context) => {
    if (segments.reduce((sum, segment) => sum + segment.text.length, 0) > MAX_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        message: 'Select a smaller passage (up to 18,000 characters).',
      });
    }
    if (new Set(segments.map((segment) => segment.id)).size !== segments.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate segment IDs.' });
    }
    if (segments.every((segment) => segment.locked || !segment.text.trim())) {
      context.addIssue({
        code: 'custom',
        message: 'There is no editable prose in this selection.',
      });
    }
  });

// Argon rejects maxItems: 160 with HTTP 400. Send the response shape to Google
// and enforce the segment cap locally before any text reaches the page.
export const rewriteResponseSchema = z.object({
  segments: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(MAX_CHARACTERS * 2),
      }),
    )
    .min(1),
});
export const rewriteOutputSchema = rewriteResponseSchema.extend({
  segments: rewriteResponseSchema.shape.segments.max(MAX_SEGMENTS),
});
export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;

export const activationSchema = z.enum(['auto', 'pick', 'selection', 'undo']);
export type Activation = z.infer<typeof activationSchema>;

export const controlMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('get-settings') }),
  z.object({
    type: z.literal('save-settings'),
    settings: settingsSchema,
    apiKey: z.string().max(512).optional(),
    rememberKey: z.boolean(),
  }),
  z.object({ type: z.literal('forget-key') }),
  z.object({ type: z.literal('activate'), mode: activationSchema }),
  z.object({ type: z.literal('open-popup') }),
]);
export type ControlMessage = z.infer<typeof controlMessageSchema>;
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
