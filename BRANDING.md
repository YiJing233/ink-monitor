# Branding

Ink Monitor is a "product on an e-ink screen" product. The brand should
match: minimal, B&W, high contrast, no ornament.

This document is the **decision template** for the parts that aren't code.

## What's already in the repo

- `public/favicon.svg` — B&W "I" monogram (square black with a white
  counter). Works at any size, no PNG fallback needed.
- `public/apple-touch-icon.png` — 180×180 PNG generated from the SVG.
- `public/og.svg` — 1200×630 social preview showing the hero copy
  ("Your e-reader is a dashboard.") and a mock `/display` panel.

## What's still TBD

### Name

Current: **Ink Monitor** (working title).

Considerations:
- "Ink" evokes e-ink.
- "Monitor" is generic but accurate.
- Alternative: **Inkwatch**, **E-ink Pulse**, **Readerboard**.
- Avoid generic "AI dashboard" names — they'll get buried.

### Tagline

Current candidates (used in repo):
- "Your e-reader is a dashboard."  (primary)
- "B&W monitoring for AI token plans and stock watchlists."  (subhead)
- "A monitoring surface for the screen that never sleeps."  (alt)

### Logo

Current favicon is an "I" monogram inside a black square. If you want
something more memorable:

1. **Hire a designer** for a real wordmark + icon. 5-7 day turnaround,
   $500-2000. Recommendations: BrandNew, Crew, or a designer on
   Dribbble/Are.na with e-ink aesthetic chops.
2. **AI-generate** a starting point with Midjourney / DALL·E 4, then
   refine in Figma. Cheaper but lower quality ceiling.
3. **Hand-draw** in Procreate. Distinctive but slow.

Constraints the logo must respect:
- B&W only. No color tokens.
- 16×16 favicon must be legible (Kindle's old WebKit rasterizes SVG
  small; pick a glyph that doesn't vanish).
- Must work on white and on Kindle's slightly-grey background.

### Colors

The product is monochrome by design. Brand colors apply only to:
- The website/landing (accent for "Sign in" button — currently `#000`)
- GitHub README badges
- Open Graph previews (black on white already)
- Documentation site, if you build one

Don't introduce a primary color. If you absolutely need a brand color
(e.g. for Twitter), pick a single ink-blue tone. **Do not** use it
inside the product.

### Typography

The product uses system stack:
```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif
ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
```

For the **marketing site / docs / press kit**:
- Sans: Inter (open source, ships on most systems)
- Mono: JetBrains Mono (open source, free)

If you need a custom wordmark logo, design it in any geometric sans
(Geist Sans, General Sans, Inter, etc.).

### Voice

**Tone**: Direct, slightly playful, never breathless.

- ✅ "Your e-reader is a dashboard."
- ✅ "60 seconds from clone to working dashboard."
- ❌ "Revolutionize the way you monitor your AI subscriptions!"
- ❌ "Unlock unprecedented visibility into your token usage!"

**Vocabulary**:
- Use "provider" not "integration", "service", or "platform"
- Use "display" not "view" or "dashboard" when referring to /display
- Use "share link" not "magic link" or "embed"
- Use "refresh" not "sync" or "poll" for the periodic data fetch

### Photography / illustrations

We don't have any. For the marketing site:

- **Real photos** of a Kindle or 小米电纸书 running the dashboard. Hire
  a photographer or use your own device. Hands holding the device,
  bedside-table context, etc.
- **Screenshots** of `/display` in a Kindle simulator
  (https://kindle.cloud/reader) showing the B&W rendering. One good
  hero shot is worth more than five mockups.
- **Avoid** AI-generated people, generic stock photo of "office workers
  looking at charts", and any 3D-rendered dashboard mockup.

### Domain

Suggested: `ink-monitor.com` or `inkmonitor.app`.
Alternatives: `inkdash.io`, `readerboard.dev`.

Check availability on Namecheap. Avoid `.io` if you want to be taken
seriously in B2B — `.com` or country-specific TLDs are fine.

## Demo video (planned, 60-90 seconds)

Suggested script:
1. (5s) Title card: "Ink Monitor"
2. (15s) A Kindle showing /display. Pan slowly. Point at the data.
3. (10s) Cut to a desktop browser. "Sign in with GitHub." One click.
4. (10s) "Add an OpenAI key." Paste. Click save.
5. (10s) "Add a stock." Type AAPL. Done.
6. (5s) Cut back to the Kindle. Same /display, now with real data.
7. (5s) End card: "ink-monitor.com"

Use a screen recorder (QuickTime, OBS, or Loom). No voiceover needed
if the on-screen text tells the story; if you do add voice, no more
than 30s of it.

## Press kit (when ready)

Put these in `docs/press/`:
- 1-page company description
- High-res logo (SVG, PNG @ 1024, PNG @ 256)
- 3 product screenshots
- 1 short video clip (15s)
- Founder bio + headshot
- Contact email

Zip it and link from `BRANDING.md` or `ink-monitor.com/press`.
