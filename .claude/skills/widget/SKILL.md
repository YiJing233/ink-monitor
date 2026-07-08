---
name: widget
description: Author a custom e-ink dashboard widget for Ink Monitor from a natural-language description. Interviews the user, emits a validated declarative WidgetManifest (data source + per-size layout), previews it 1:1, and installs it. The gen-UI loop — produces a manifest, never code.
---

# Ink Monitor — Widget authoring (gen-UI)

Turn "I want to see X on my e-ink screen" into a working widget. The output is a
**declarative `WidgetManifest` (JSON)** — not code — validated against the IR
schema and rendered by the platform's trusted renderer. This is what keeps it
safe on a multi-tenant server and guaranteed-correct on B&W e-ink.

## Ground truth (read these first)

- **Schema**: `lib/widgets/ir.ts` — the closed vocabulary. A manifest may only
  use these nodes (`bignum`, `metric`, `series`, `table`, `list`, `image`, `qr`,
  `text`, `divider`, `row`/`col`/`grid`) and these source kinds.
- **Examples**: `lib/widgets/manifests/*.json` — `api-usage` (read-only binding),
  `todo-lark` (owned/external state), `gallery` (binary assets). Mirror these.
- **Sizes**: `lib/widgets/devices.ts` (grid geometry) + `placement.ts`
  (`resolveFamily` fallback).

## The loop

1. **Interview** — ask only what's missing:
   - What do you want to see? Where does the data come from (URL / built-in
     provider / your own list / photos)?
   - Which sizes? (1×1 glance, 2×1 row, 2×2 card, 4×2 banner, 4×4 hero)
   - How often should it refresh? (e-ink + battery — bias slow: 300–1800s)
2. **Pick the source kind** (trust tiers, least-privilege first):
   - `builtin` — a fetcher already in the repo (`provider:openai`, `stocks`).
   - `http` — any JSON API. Declarative only: `url` + `auth` + `select` (map
     output keys to JSONPaths). The default for user widgets.
   - `owned` — a list the platform stores (TODO, notes, counters). Edited on the
     authoring plane, not on the glass.
   - `asset` — photos; the platform dithers them to 1-bit.
   - `demo` — inline sample data for trying it out.
3. **Author the layout per family.** Size is *information density*, not scaling:
   - Write the richest variant first (usually `2x2`), then **demote**: drop the
     chart for `2x1`, keep only a `bignum`/`metric` for `1x1`.
   - Bind values with `{ "$": "path.into.source" }`; literals are bare.
4. **Declare capabilities** — `egress` domains, `secrets` needed, `writes`.
   These become the install-time permission prompt. Be exact and minimal.
5. **Validate** — the manifest must pass `validateManifest()` from `ir.ts`.
   Fix any ZodError before continuing.
6. **Preview 1:1** — open `/preview?d=<urlencoded {device, items:[{m,x,y,w,h}]}>`
   (the same renderer as `/display`). Check every declared family at its size.
7. **Install** — add it to the user's dashboard via the Canvas editor
   (`/admin/canvas`) or the widgets API once wired.

## Hard rules (e-ink reality)

- **The display is read-only.** No clicks, no JS on the glass. Any "interaction"
  happens on the authoring plane (`/admin`), via this skill/API, or by rendering
  a `qr` node that opens an action on the user's phone.
- **B&W only, no animation.** The renderer enforces this; don't fight it.
- **Refresh is a budget.** More widgets + faster refresh = more full-screen
  reflashes. Default slow; only go fast for genuinely live data.
- **Never invent nodes or source kinds.** If the vocabulary can't express it,
  say so and propose the smallest schema addition instead of emitting code.

## Minimal example (a 1×1 + 2×2 weather widget)

```json
{
  "v": 1, "id": "weather-london", "name": "Weather",
  "source": {
    "kind": "http",
    "url": "https://api.openweathermap.org/data/2.5/forecast?q=London&appid={{OWM_KEY}}&units=metric",
    "auth": { "type": "none" },
    "select": { "temp": "list[0].main.temp", "cond": "list[0].weather[0].main", "hourly": "list[*].main.temp" }
  },
  "families": ["1x1", "2x2"],
  "layout": {
    "1x1": { "t": "bignum", "value": { "$": "temp" }, "unit": "°C", "sub": { "$": "cond" } },
    "2x2": { "t": "col", "children": [
      { "t": "bignum", "value": { "$": "temp" }, "unit": "°C", "sub": { "$": "cond" } },
      { "t": "series", "kind": "bar", "data": { "$": "hourly" }, "window": "24h" }
    ]}
  },
  "capabilities": { "egress": ["api.openweathermap.org"], "secrets": ["OWM_KEY"] },
  "refresh": 1800
}
```
