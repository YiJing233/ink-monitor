# Ink Monitor — Widget Platform Architecture

How Ink Monitor goes from two hard-coded widget types (providers, stocks) to a
platform where users author arbitrary e-ink dashboard widgets — via a skill, a
canvas, or a gallery — without sacrificing multi-tenant safety or e-ink fidelity.

---

## The load-bearing decision

> **A widget is a validated declarative `WidgetManifest` (JSON), never code.**
> The "generative UI" surface is constrained to producing valid manifests; the
> platform owns the trusted renderer.

Naive gen-UI (LLM → JSX → eval) is a non-starter here for two reasons:

1. **Display target** — B&W e-ink, no JS, full-screen meta-refresh. Arbitrary
   HTML/JS renders badly and breaks the soft-refresh contract.
2. **Multi-tenant SaaS** with per-user encrypted keys — running model/user code
   server-side is RCE/XSS/secret-exfiltration.

A schema-constrained manifest + a closed render vocabulary solves both at once:
no code execution, and output that is provably e-ink-safe.

This is **Server-Driven UI**, specialized for e-ink (cf. Block Kit / Adaptive
Cards).

---

## Two planes

| Plane | Where | Constraints | Job |
|---|---|---|---|
| **Authoring** | `/admin` (modern browser) | none — rich DnD, color, JS | arrange, preview, generate manifests |
| **Display** | `/display` (e-ink) | read-only, no JS, B&W, reflash | render committed layout statically |

They connect through the `layout JSON + manifest` artifact. **Corollary:** the
e-ink glass is a read-only *ambient* surface. Any "interaction" (checking a TODO,
adding a note) happens on the authoring plane, via the skill/API, or by rendering
a `qr` node that opens an action on the user's phone.

---

## Layers

```
L6  Authoring / gen-UI   .claude/skills/widget         interview → manifest → validate → preview → install
L5  Composition          lib/widgets/placement.ts      dashboards, per-device grid placement
L4  Renderer             lib/widgets/render/*           IR + data → e-ink HTML (the ONLY renderer)
L3  Binding              lib/widgets/bind.ts            {$:path} → source data
L2  View IR              lib/widgets/ir.ts              closed node vocabulary + manifest schema (versioned)
L1  Source               (existing lib/providers + …)   data adapters, by trust tier
L0  Kernel               existing app/lib               auth, multi-tenancy, crypto, SQLite, cache, e-ink shell
```

Today's code already implements halves of L1 (the `ProviderFetcher` registry)
and L4 (the hand-written `ProviderCard` / `Sparkline` in `app/display/page.tsx`).
This pass adds L2/L3/L5 and a generic L4, and re-expresses the existing cards as
manifests to prove the vocabulary.

---

## L2 — The IR vocabulary (`lib/widgets/ir.ts`)

Closed, versioned (`v: 1`). A manifest composes only these nodes:

- **Data**: `bignum`, `metric` (usage bar), `series` (`bar`|`spark`), `table`,
  `list` (with `check` for TODO), `text`.
- **Media**: `image` (server-dithered), `qr`.
- **Layout**: `row`, `col`, `grid`, `divider`.

`Bind` = a literal or `{ "$": "path" }` into the source data.

A `Manifest` = `{ v, id, name, source, families[], layout{per-family}, capabilities, refresh }`.

---

## Size families (Apple-widget model)

The same widget declares **`families`** (which sizes it supports) and a **layout
variant per family**. Size is *information density, not scaling* — `1x1` shows a
number, `2x2` adds a chart.

- Families: `1x1 2x1 1x2 2x2 4x2 4x4` (spans of grid cells).
- **Fallback** (`placement.ts#resolveFamily`): exact match → largest variant that
  fits → smallest variant (centered, never upscaled into an empty box).
- **gen-UI demotion**: the skill authors the richest variant first, then derives
  smaller ones by dropping detail.

### Grid + device profiles (`lib/widgets/devices.ts`)

A "cell" is the base unit; families are cell spans. Each device profile fixes the
grid + native pixel size:

| Device | px | grid |
|---|---|---|
| Kindle Paperwhite | 1072×1448 | 4×6 |
| Kindle Oasis | 1264×1680 | 4×6 |
| 小米多看 Pro | 1648×2200 | 4×7 |
| Boox Note | 1404×1872 | 6×8 |
| 通用横屏 | 1448×1072 | 6×4 |

### Cross-device adaptation (in the data model)

`Dashboard.layouts` is keyed **per device** (`Partial<Record<DeviceId, Placement[]>>`).
`layoutFor()` returns the device's own layout, else auto-reflows from the base
device (`autoReflow` clamps spans + row-packs). Users can hand-override per device.

---

## L1 — Source trust tiers

| Tier | `source.kind` | Runs on hosted SaaS? | Example |
|---|---|---|---|
| Built-in | `builtin` | ✅ | `provider:openai`, `stocks` |
| Declarative HTTP | `http` | ✅ (most user widgets) | weather, any JSON API |
| Owned state | `owned` | ✅ | TODO, notes, counters |
| Asset | `asset` | ✅ | photo album |
| Sandboxed code | *(future)* | self-host only | arbitrary transforms |

`http` is purely declarative: `url` + `auth` + `select` (output key → JSONPath).
No code → safe to host.

---

## The 1:1 preview guarantee

`/preview` renders a dashboard at the device's **native pixel size** through the
**same `WidgetRenderer`** that `/display` uses. The canvas editor iframes
`/preview` and scales it down. Because there is exactly one renderer, the web
preview is a perfect replica of the glass — there is no second code path to drift.

---

## The three reference widgets = three extension axes

| Widget | Axis it proves | What it forced |
|---|---|---|
| `api-usage` | read-only binding | reuse existing provider data; family decomposition |
| `todo-lark` | owned / external state + interactivity | `owned`/`http` source; read-only-glass truth; `qr` action |
| `gallery` | binary assets | `image` node + (future) server dithering pipeline |

(`todo-lark` binds to Feishu/Lark Tasks — the repo already ships a `lark-task`
skill, so it's a real integration, not a hypothetical.)

---

## Files added in this pass

```
lib/widgets/
  ir.ts                 L2 — Zod schemas: Bind, Node, Source, Manifest, families
  devices.ts            device profiles + grid geometry
  placement.ts          L5 — Dashboard/Placement, resolveFamily, rectPx, autoReflow
  bind.ts               L3 — {$:path} resolution (reuses utils.resolvePath)
  registry.ts           loads + validates the built-in manifests
  manifests/
    api-usage.json  todo-lark.json  gallery.json   (canonical examples)
    sample-data.ts      fixtures so previews work with no backend
  render/
    primitives.tsx      L4 — one renderer per node, reuses globals.css eink-* classes
    WidgetRenderer.tsx  L4 — picks family variant, draws the card

app/
  preview/page.tsx               public 1:1 e-ink preview (shared renderer)
  admin/canvas/page.tsx          authoring shell
  admin/canvas/canvas-editor.tsx snap-grid DnD + device switch + live 1:1 preview
  admin/layout.tsx               + Canvas nav tab

.claude/skills/widget/SKILL.md   the gen-UI authoring loop

  --- Phase 0 completion: persistence + source execution + image pipeline ---
lib/widgets/
  source.ts             L1 — resolveSource (demo/builtin/http/owned/asset) + resolveDashboard
  safe-fetch.ts         SSRF guard: ip/host classifiers + guarded fetch        [tested]
  select.ts             JSONPath-lite for http `select` (+ [*] wildcard)        [tested]
  dither.ts             Atkinson/FS dithering + dependency-free PNG encoder     [tested]
  manifests/stocks-table.json    stock watchlist re-expressed as a widget
  render/DashboardCanvas.tsx      shared full-dashboard canvas (display + preview)
lib/db.ts               + dashboards / widgets / widget_secrets / owned_state tables + CRUD
app/api/dashboards/**   dashboard CRUD
app/api/widgets/**      widget CRUD + manifest validate (used by the skill)
app/api/widget-secrets  encrypted per-user secrets for http sources
app/api/asset/dither    image dithering proxy (sharp decode + graceful fallback)
app/display/page.tsx    + opt-in "render my dashboard" branch

  --- Palette/library + Market + QR + signing ---
lib/widgets/
  qr.ts                 scannable B&W QR matrix (via qrcode lib)               [tested]
  sign.ts               HMAC sign/verify for proxy URLs                        [tested]
  capabilities.ts       capabilities -> permission-prompt notices             [tested]
lib/db.ts               + user_manifests table + CRUD (manifest library)
app/api/manifests/**    library CRUD + manifest validate (skill / market)
app/admin/market/**     gallery + install permission prompt + share/import
app/admin/canvas/**     palette = built-ins + library (◇); per-device layouts; Save
```

---

## Status

**Wired now (Phase 0 complete + hardening) — `tsc --noEmit` clean, `pnpm test` green:**

- **Persistence** — `dashboards` / `widgets` / `widget_secrets` / `owned_state`
  tables + CRUD (`lib/db.ts`), and `/api/dashboards`, `/api/widgets`,
  `/api/widget-secrets`. `/display` renders the user's dashboard via the shared
  canvas (opt-in; legacy provider/stock view is the fallback).
- **Source execution** — `lib/widgets/source.ts` resolves demo/builtin/http/
  owned/asset; provider + stock cards re-expressed as manifests (`api-usage`,
  `stocks-table`).
- **SSRF hardening** — `lib/widgets/safe-fetch.ts`: scheme check, DNS-resolved
  private/metadata IP blocking, manual redirect re-validation, timeout + byte
  cap, `capabilities.egress` allowlist. Unit-tested.
- **Image pipeline** — `lib/widgets/dither.ts` (Atkinson/FS + dependency-free
  PNG encoder, unit-tested) behind `/api/asset/dither` (uses `sharp` to decode;
  degrades to a redirect if `sharp` isn't built).
- **Canvas editor persistence** — `/admin/canvas` loads your saved dashboard;
  Save creates/updates it via `POST /api/dashboards` + `PUT /api/dashboards/[id]`
  (atomic rebuild of widget instances + this device's layout, plus orphan GC).
  "View real data" previews your own data 1:1 via `/preview?dashboard=<id>`
  (owner-only, same renderer as `/display`).
- **Market + manifest library** — `/admin/market` installs widgets into a
  per-user library (`user_manifests` + `/api/manifests`) behind an install-time
  permission prompt (egress / secrets / writes derived from `capabilities`, see
  `lib/widgets/capabilities.ts`); share via a portable code, import by paste. The
  canvas palette shows built-ins + your library (◇); custom widgets save inline.
- **Real QR** — `lib/widgets/qr.ts` (via the `qrcode` lib) renders scannable B&W
  modules; powers "scan to act" on the read-only display. Unit-tested.
- **Per-device layouts** — the editor keeps one layout per device; switching
  loads that device's saved layout (or seeds it via auto-reflow). Save persists
  the active device.
- **Asset-proxy signing** — `/api/asset/dither` only serves HMAC-signed URLs
  minted by the Source layer (`lib/widgets/sign.ts`), closing the open-proxy
  hole. Unit-tested.
- **Aggregator cleanup (+ bug fix)** — `fetchUsageForUser` is now the single
  fetch entry in `lib/providers/index.ts`; the duplicated/incorrect dispatch in
  `lib/aggregator.ts` is gone. The fix routes groq/mistral/deepseek/moonshot/
  zhipu/openrouter/ollama to the `openai` fetcher (registry `REGISTRY`) instead
  of `custom` — they were being fetched with the wrong fetcher on `/display`.
- **Soft-refresh generalization** — shared `app/display/soft-refresh.tsx` works
  for both legacy provider/stock pages (via `data-pid`/`data-symbol`) and the
  dashboard (via `data-w-inst` on each `DashboardCanvas` instance). e-ink UAs
  still fall back to `<meta http-equiv="refresh">`.
- **Editor collision** — `overlaps`/`hasCollision` (in `lib/widgets/placement.ts`,
  unit-tested). The editor blocks move/resize that would overlap another
  instance; saving never lands overlapping placements.
- **Remote gallery + versions** — `lib/widgets/version.ts` (semver comparator,
  unit-tested); `version` field on `ManifestSchema`; curated remote gallery at
  `/api/market` (default reads `public/market/registry.json`, override with
  `MARKET_REGISTRY_URL`); Market UI shows "可更新" + a one-click update flow.
- **Album pipeline** — new `album` source kind rotates a URL list (stored in
  platform-owned state) by the manifest's `refresh_seconds` bucket. Adapter
  seam (`lib/widgets/album-store.ts`) so a disk/Blob impl can plug in later.
- **Album upload** — `diskAlbumStore` (self-host) handles multipart uploads to
  `data/albums/<userId>/<album>/`; `/api/album-asset/...` serves them to the
  owner. `urlsAlbumStore` (Vercel-friendly) stays the default off-host via
  `ALBUM_STORE=disk`. `/admin/albums` lists + uploads + deletes with
  thumbnails. **Hosted backends:** `vercelBlobAlbumStore` (auto-detected on
  Vercel with `BLOB_READ_WRITE_TOKEN`) and `s3AlbumStore` (S3 / R2 / MinIO
  via `S3_ENDPOINT`) plug in via `ALBUM_STORE=vercel-blob|s3`; both use
  `@vercel/blob` / `@aws-sdk/client-s3` as optionalDependencies so they
  don't force-install.
- **Market auth** — `MARKET_REGISTRY_TOKEN` (Bearer) or
  `MARKET_REGISTRY_HMAC_KEY` (HMAC over `METHOD\nURL\nTS` with a 5-min
  replay window) opt-in flips `/api/market` from anonymous to
  authenticated; upstream 401/403 surface to the caller with a short
  message.
- **Security tightening (P1 fixes)** — Zod-segment whitelist +
  `assertSafeAlbumPath()` close the `/api/albums` path-traversal; the
  `?u=<userId>` and `x-ink-user` fallbacks are removed from `/display`
  and `/api/snapshot` (only session or `?share=` accepted); the
  soft-refresh selector bug (which always produced `[data-="…"]`) is
  fixed with per-selector key groups; `PUT /api/dashboards/[id]` is
  wrapped in a single `withTx()`; `http` source `body` is now templated
  and forwarded; production `ENCRYPTION_KEY` is required at boot.
- **Per-device refresh overrides** — `dashboards.refresh_overrides_json` lets
  the user pin a max-refresh-per-device (a cap, not a floor). The editor
  exposes a per-device input; `/display` honors it.
- **Market discovery** — registry items now carry `category`/`author`/`icon`
  (registry metadata, not manifest). Market UI: search box, category filter,
  hide-installed toggle, count, and per-card icon + category pill.
  Self-host disk cache added to the dither route.

**Still to do (post-roadmap):**

1. **Hardening (non-blocking)** — undici IP pinning to close DNS-rebinding
   TOCTOU in `safe-fetch`; per-dashboard `gcWidgets` scope narrowing;
   e-ink UA list extension (Kobo/PocketBook/Onyx BOOX); secure-default
   `capabilities.egress` for manifests that omit it; 1-bit PNG output
   from the dither pipeline. See the code review report for the full list.

---

## Roadmap

- **Phase 0** *(this pass + persistence)* — IR, renderer, device/grid model,
  canvas, re-express provider/stock cards as manifests.
- **Phase 1** — declarative `http` source + 3–4 non-usage built-ins
  (clock, weather, countdown, RSS).
- **Phase 2** — the authoring skill loop + manifest validation + preview render.
- **Phase 3** — gallery/market + install permissions + sharing.
- **Phase 4** *(optional)* — sandboxed code sources for the long tail
  (self-host only).
