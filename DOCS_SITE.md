# Documentation site

The README is comprehensive but not searchable. A dedicated docs site
at `docs.ink-monitor.com` is the standard.

## Decision: framework

Three realistic options.

### Mintlify (recommended for launch)

- Hosted, $0 free tier (1 editor, no custom domain) → $150+/mo for
  production usage
- Best UI of the three out of the box — three-pane nav, code blocks,
  search, dark mode toggle, API reference
- Native OpenAPI integration: feed it our `/openapi.json` and you
  get an auto-generated API reference
- `mint.json` config file in the repo
- CI deploys on push to main

### Docusaurus

- Self-host on Vercel, free tier covers it
- Open source, full control
- Markdown + MDX, the React docs use it
- More setup work; UI is good but not as polished as Mintlify
- No native OpenAPI; you'd need `docusaurus-openapi-docs`

### Nextra

- Self-host on Vercel, free
- Built on Next.js (matches our stack)
- MDX + search + theming
- Lighter than Docusaurus; less common in the ecosystem
- No OpenAPI integration

**My recommendation**: Mintlify for the first 6 months. When revenue
justifies it, migrate to Docusaurus (or fork and host on your own
infrastructure to own the docs and avoid vendor lock-in).

## Page structure (suggested)

```
docs.ink-monitor.com/
├── /                          # Welcome
├── /quickstart                # 5-minute setup
├── /self-host                 # Detailed self-host guide
├── /deploy/vercel              # Vercel deploy step-by-step
├── /deploy/docker              # Docker deploy (when ready)
├── /concepts/providers         # How provider integrations work
├── /concepts/stocks            # How stock data flows
├── /concepts/e-ink             # Why /display looks the way it does
├── /concepts/encryption        # Crypto model in depth
├── /cli                       # `npx ink-monitor` reference
├── /api                       # Auto-generated from openapi.json
├── /guides/oauth              # Setting up your own GitHub OAuth app
├── /guides/webhooks           # Building with webhooks
├── /guides/migrate-data       # Self-host → SaaS, or vice versa
├── /faq                       # Common questions
├── /troubleshooting            # "Why is my data stale" etc.
└── /changelog                  # Mirror of CHANGELOG.md
```

## Generating the API reference

Mintlify supports `openapi.json` directly. Put ours at
`/api-reference/openapi.json` and Mintlify renders it. For Docusaurus:

```bash
pnpm add docusaurus-openapi-docs
```

In `docusaurus.config.ts`:
```ts
plugins: [
  ['docusaurus-plugin-openapi-docs', {
    config: {
      ink: {
        specPath: '../openapi.json',  // relative to docs/
        outputDir: 'docs/api',
        sidebar: 'apiSidebar',
      },
    },
  }],
],
```

## What to write first

Order of writing, by what users will look for first:

1. **Quickstart** — copy from README "Quickstart (local)"
2. **API reference** — auto-generated from openapi.json
3. **CLI reference** — copy from README "CLI" section
4. **Self-host** — copy from DEPLOY.md
5. **Concepts** — provider, stock, e-ink, encryption (4 docs)
6. **Guides** — OAuth setup, webhooks, migration
7. **FAQ + troubleshooting**

## Search

Mintlify and Docusaurus both ship with Algolia DocSearch (free for
open source). Submit your sitemap at
https://docsearch.algolia.com/apply/ — typically gets indexed within
2 weeks.

## Analytics

Plausible (privacy-friendly, $9/mo for 10K events) is the
recommendation. Avoid Google Analytics for a privacy-respecting
product.
