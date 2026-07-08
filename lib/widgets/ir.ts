/**
 * Widget IR (Intermediate Representation) — the closed, versioned vocabulary
 * the e-ink renderer guarantees to draw correctly.
 *
 * A `Manifest` is what a skill / the canvas editor produces. It is pure data
 * (no code), validated against these Zod schemas before it is ever rendered or
 * stored. The "generative UI" surface is constrained to producing valid
 * manifests; the platform owns the trusted renderer (lib/widgets/render).
 *
 * Apple-widget sizing: a manifest declares `families` (which sizes it supports)
 * and a `layout` variant per family — size is *different information density*,
 * not scaling. See lib/widgets/placement.ts#resolveFamily for the fallback.
 *
 * This module is client-safe (Zod only). Do not import server-only code here.
 */
import { z } from 'zod';

// --- Size families (grid spans, Apple `WidgetFamily` analogue) ---
export const FAMILIES = ['1x1', '2x1', '1x2', '2x2', '4x2', '4x4'] as const;
export type Family = (typeof FAMILIES)[number];
export const FamilySchema = z.enum(FAMILIES);

// --- Bind: a literal value, or a reference {$: "path"} into the source data ---
export const BindSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.object({ $: z.string() }).strict(),
]);
export type Bind = z.infer<typeof BindSchema>;

// --- Render nodes (recursive, discriminated on `t`) ---
export type Node =
  | { t: 'text'; value: Bind; size?: 'title' | 'body' | 'caption'; mono?: boolean }
  | { t: 'bignum'; value: Bind; unit?: string; sub?: Bind }
  | { t: 'metric'; label?: string; value: Bind; max?: Bind; unit?: string; reset?: Bind; window?: string }
  | { t: 'series'; kind: 'bar' | 'spark'; data: Bind; window?: string; unit?: string }
  | { t: 'table'; columns: TableCol[]; rows: Bind }
  | { t: 'list'; items: Bind; primary: string; secondary?: string; check?: string; max?: number }
  | { t: 'image'; src: Bind; fit?: 'cover' | 'contain'; dither?: 'atkinson' | 'floyd' | 'none'; alt?: string }
  | { t: 'qr'; value: Bind; caption?: Bind }
  | { t: 'divider' }
  | { t: 'row'; gap?: number; children: Node[] }
  | { t: 'col'; gap?: number; children: Node[] }
  | { t: 'grid'; cols?: number; gap?: number; children: Node[] };

export interface TableCol {
  key: string;
  label: string;
  align?: 'left' | 'right';
  mono?: boolean;
}

const TableColSchema = z.object({
  key: z.string(),
  label: z.string(),
  align: z.enum(['left', 'right']).optional(),
  mono: z.boolean().optional(),
});

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('text'), value: BindSchema, size: z.enum(['title', 'body', 'caption']).optional(), mono: z.boolean().optional() }),
    z.object({ t: z.literal('bignum'), value: BindSchema, unit: z.string().optional(), sub: BindSchema.optional() }),
    z.object({ t: z.literal('metric'), label: z.string().optional(), value: BindSchema, max: BindSchema.optional(), unit: z.string().optional(), reset: BindSchema.optional(), window: z.string().optional() }),
    z.object({ t: z.literal('series'), kind: z.enum(['bar', 'spark']), data: BindSchema, window: z.string().optional(), unit: z.string().optional() }),
    z.object({ t: z.literal('table'), columns: z.array(TableColSchema), rows: BindSchema }),
    z.object({ t: z.literal('list'), items: BindSchema, primary: z.string(), secondary: z.string().optional(), check: z.string().optional(), max: z.number().optional() }),
    z.object({ t: z.literal('image'), src: BindSchema, fit: z.enum(['cover', 'contain']).optional(), dither: z.enum(['atkinson', 'floyd', 'none']).optional(), alt: z.string().optional() }),
    z.object({ t: z.literal('qr'), value: BindSchema, caption: BindSchema.optional() }),
    z.object({ t: z.literal('divider') }),
    z.object({ t: z.literal('row'), gap: z.number().optional(), children: z.array(NodeSchema) }),
    z.object({ t: z.literal('col'), gap: z.number().optional(), children: z.array(NodeSchema) }),
    z.object({ t: z.literal('grid'), cols: z.number().optional(), gap: z.number().optional(), children: z.array(NodeSchema) }),
  ]),
);

// --- Source: where a widget's data comes from, split by trust tier ---
export const AuthSchema = z.object({
  type: z.enum(['none', 'bearer', 'header']),
  secret: z.string().optional(), // name of the required secret (declared, never the value)
  header: z.string().optional(), // header name when type === 'header'
});
export type Auth = z.infer<typeof AuthSchema>;

export const SourceSchema = z.discriminatedUnion('kind', [
  // Inline sample data — used for previews and the gallery thumbnails.
  z.object({ kind: z.literal('demo'), data: z.any().optional() }),
  // Compiled, trusted fetcher in the repo (e.g. ref: "provider:openai", "stocks").
  z.object({ kind: z.literal('builtin'), ref: z.string(), config: z.record(z.any()).optional() }),
  // Declarative HTTP — no code. The safe path for most user widgets.
  z.object({
    kind: z.literal('http'),
    url: z.string(),
    method: z.enum(['GET', 'POST']).optional(),
    auth: AuthSchema.optional(),
    config: z.record(z.any()).optional(),
    // Optional request body (POST). Subject to the same {{VAR}} substitution
    // as the URL, so secrets can ride in the body the way they ride in the
    // query string today.
    body: z.string().optional(),
    // Normalize raw JSON into a flat object the binds reference: out -> JSONPath.
    select: z.record(z.string()).optional(),
    ttl: z.number().optional(),
  }),
  // Platform-owned state (TODO, notes, counters) — written on the authoring plane.
  z.object({ kind: z.literal('owned'), store: z.string() }),
  // Binary assets (photos) — server dithers + pre-renders per family.
  z.object({ kind: z.literal('asset'), album: z.string().optional() }),
  // Rotating album (URL list in platform storage; rotates by refresh bucket).
  z.object({ kind: z.literal('album'), album: z.string(), refresh_seconds: z.number().optional() }),
]);
export type Source = z.infer<typeof SourceSchema>;

// --- Capability declaration (surfaced at install time as a permission prompt) ---
export const CapabilitiesSchema = z
  .object({
    egress: z.array(z.string()).optional(), // domains the widget will call
    secrets: z.array(z.string()).optional(), // secret names it needs
    writes: z.boolean().optional(), // mutates platform-owned state
  })
  .optional();

// --- Per-family layout (at least one family required) ---
export const LayoutSchema = z
  .object({
    '1x1': NodeSchema.optional(),
    '2x1': NodeSchema.optional(),
    '1x2': NodeSchema.optional(),
    '2x2': NodeSchema.optional(),
    '4x2': NodeSchema.optional(),
    '4x4': NodeSchema.optional(),
  })
  .refine((o) => Object.values(o).some(Boolean), { message: 'layout needs at least one family' });
export type Layout = z.infer<typeof LayoutSchema>;

// --- The manifest: the unit a skill emits and the gallery distributes ---
export const ManifestSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Optional semantic version of the manifest itself (NOT the IR version `v`).
  // The Market shows "update available" when a registered entry's `version` is
  // greater than the one in the user's library.
  version: z.string().optional(),
  source: SourceSchema,
  families: z.array(FamilySchema).nonempty(),
  layout: LayoutSchema,
  capabilities: CapabilitiesSchema,
  refresh: z.number().optional(), // seconds; the dashboard refresh = min across widgets
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** Parse + validate. Throws ZodError with a readable path on failure. */
export function validateManifest(input: unknown): Manifest {
  return ManifestSchema.parse(input);
}

/** Safe variant for API boundaries — returns a result instead of throwing. */
export function safeValidateManifest(input: unknown) {
  return ManifestSchema.safeParse(input);
}
