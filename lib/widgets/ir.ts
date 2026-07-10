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
export const FAMILIES = ['1x1', '2x1', '1x2', '2x2', '4x1', '4x2', '4x4'] as const;
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
  | { t: 'text'; value: Bind; size?: 'title' | 'body' | 'caption'; mono?: boolean; prefix?: string }
  // `unit` accepts a Bind so a layout can stamp a server-side dynamic unit
  // (e.g. Home Assistant's `attributes.unit_of_measurement`) without a
  // separate `text` node. A plain string is still valid — the union makes
  // existing manifests backward-compatible.
  | { t: 'bignum'; value: Bind; unit?: Bind; sub?: Bind }
  | { t: 'metric'; label?: string; value: Bind; max?: Bind; unit?: string; reset?: Bind; window?: string }
  | { t: 'series'; kind: 'bar' | 'spark'; data: Bind; window?: string; unit?: string }
  | { t: 'table'; columns: TableCol[]; rows: Bind }
  // `primary` is optional: when omitted, each list item is rendered as a
  // primitive (`String(it)`). Lets a manifest bind a string-array select
  // (e.g. an RSS feed's `item[*].title`) directly without an intermediate
  // re-shape.
  | { t: 'list'; items: Bind; primary?: string; secondary?: string; check?: string; max?: number }
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
    z.object({ t: z.literal('text'), value: BindSchema, size: z.enum(['title', 'body', 'caption']).optional(), mono: z.boolean().optional(), prefix: z.string().optional() }),
    z.object({ t: z.literal('bignum'), value: BindSchema, unit: BindSchema.optional(), sub: BindSchema.optional() }),
    z.object({ t: z.literal('metric'), label: z.string().optional(), value: BindSchema, max: BindSchema.optional(), unit: z.string().optional(), reset: BindSchema.optional(), window: z.string().optional() }),
    z.object({ t: z.literal('series'), kind: z.enum(['bar', 'spark']), data: BindSchema, window: z.string().optional(), unit: z.string().optional() }),
    z.object({ t: z.literal('table'), columns: z.array(TableColSchema), rows: BindSchema }),
    z.object({ t: z.literal('list'), items: BindSchema, primary: z.string().optional(), secondary: z.string().optional(), check: z.string().optional(), max: z.number().optional() }),
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
    // Optional static + templated request headers. Both the name and value
    // pass through `{{VAR}}` substitution from `config` and any declared
    // secret, so a manifest can carry auth headers that the fixed `auth`
    // enum can't express today (e.g. Plex's `X-Plex-Token: <raw>` header or
    // Home Assistant's `Authorization: Bearer <token>` header).
    headers: z.record(z.string()).optional(),
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

// --- Per-widget config schema (declarative UI for the QR-backed editor) ---
// Any manifest can declare editable per-instance config fields. The generic
// editor at `/admin/widgets/[id]/edit-config` renders one input per entry;
// POST `/api/widgets/[id]/config` validates the body against this schema (the
// server is the source of truth — even the generic client editor cannot write
// fields that aren't declared here). The `notes` widget is the first user.
export const CONFIG_FIELD_TYPES = ['text', 'multiline', 'lines', 'number', 'boolean'] as const;
export type ConfigFieldType = (typeof CONFIG_FIELD_TYPES)[number];

/**
 * One editable field. Keys map 1:1 to entries in `widget.config_json`.
 *
 * `type` controls the rendered input + the server-side validator:
 *   - `text`     → single-line `<input type="text">`
 *   - `multiline`→ `<textarea>`
 *   - `lines`    → string[]; one entry per non-empty line (notes widget)
 *   - `number`   → `<input type="number">`; `min` / `max` clamp
 *   - `boolean`  → checkbox
 *
 * Type-specific validators carry the per-field limits (e.g. `maxChars`,
 * `maxLines`) so the manifest author can tune them per widget without the
 * IR needing per-type sub-schemas. Limits are optional — defaults are
 * defined on the editor + API side.
 */
export const ConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(CONFIG_FIELD_TYPES),
  // Optional human hint rendered under the input. Plain text only — the
  // editor renders via React textContent so there's no XSS surface.
  hint: z.string().optional(),
  // text / multiline / lines
  maxChars: z.number().int().positive().optional(),
  // lines
  maxLines: z.number().int().positive().optional(),
  // number
  min: z.number().optional(),
  max: z.number().optional(),
  // text / multiline
  placeholder: z.string().optional(),
  // Default the editor falls back to when the key is missing from
  // config_json. Boolean fields interpret `false` as the default.
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

// --- Per-family layout (at least one family required) ---
export const LayoutSchema = z
  .object({
    '1x1': NodeSchema.optional(),
    '2x1': NodeSchema.optional(),
    '1x2': NodeSchema.optional(),
    '2x2': NodeSchema.optional(),
    '4x1': NodeSchema.optional(),
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
  // Optional declarative editor schema. When present, the generic QR-backed
  // editor (`/admin/widgets/[id]/edit-config`) renders one input per field;
  // POST /api/widgets/[id]/config validates the body against this array.
  // Manifests without this field have no QR editor (the legacy notes path
  // is preserved via a redirect from /edit-notes → /edit-config).
  config_schema: z.array(ConfigFieldSchema).optional(),
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
