import { z } from 'zod'

/**
 * What the model may return (D-011): normalized 0..1 coordinates relative to
 * the screenshot. Arrow and circle use (x, y) as the target point or centre;
 * rect uses it as the top-left corner. w/h are fractions too.
 */
export const Annotation = z.object({
  type: z.enum(['arrow', 'circle', 'rect']),
  x: z.number(),
  y: z.number(),
  w: z.number().optional(),
  h: z.number().optional(),
  label: z.string().max(80).optional(),
})
export type Annotation = z.infer<typeof Annotation>

export const MAX_ANNOTATIONS = 8

/** An annotation in overlay pixels (DIPs, relative to the display's top-left). */
export const OverlayShape = z.object({
  type: z.enum(['arrow', 'circle', 'rect']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  label: z.string().max(80),
})
export type OverlayShape = z.infer<typeof OverlayShape>

export const OverlayPayload = z.object({
  shapes: z.array(OverlayShape).max(MAX_ANNOTATIONS),
  durationMs: z.number().int().positive(),
})
export type OverlayPayload = z.infer<typeof OverlayPayload>
