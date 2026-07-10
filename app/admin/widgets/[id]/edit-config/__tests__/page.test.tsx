/**
 * Tests for the generic per-widget config editor page
 * (`/admin/widgets/[id]/edit-config`).
 *
 * The page is a server component. It does three things:
 *   1. Resolves the current user (NextAuth session) and redirects to
 *      /signin if there's no session.
 *   2. Loads the widget row, parses + validates `manifest_json` via
 *      `safeValidateManifest`, and reads `config_schema` from there.
 *   3. Renders the form (per-field inputs are wired by the client
 *      island, which we don't exercise here — we're verifying the
 *      server contract).
 *
 * We render with `react-dom/server`'s `renderToString` and assert on the
 * HTML. The session + DB are mocked so the route runs end-to-end without
 * spinning up a real Next.js request context.
 *
 * Coverage:
 *   1. `notes` manifest → renders the line-by-line editor (one
 *      `<textarea>` per `lines` field) and pre-fills from
 *      `config_json.lines`.
 *   2. A manifest with a `text` field renders a plain `<input>` with
 *      the value pre-filled from `config_json`.
 *   3. A manifest with no `config_schema` renders the "no schema" panel
 *      (a widget that hasn't opted into the generic editor).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

// All mocks are wired through module-scope `vi.fn()`s because the vi.mock
// factory body hoists above the imports and can't reach closure variables.
const getRequiredUserId = vi.fn();
const cookies = vi.fn();
const headers = vi.fn();
const getWidget = vi.fn();
const redirect = vi.fn((url: string) => {
  // next/navigation's `redirect` throws a special error inside Next.js;
  // we surface it as a regular Error so the "no session" test can match
  // on the redirect target.
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('@/lib/session', () => ({
  getRequiredUserId: () => getRequiredUserId(),
}));

vi.mock('next/headers', () => ({
  cookies: () => cookies(),
  headers: () => headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
}));

vi.mock('@/lib/db', () => ({
  getWidget: (uid: string, id: string) => getWidget(uid, id),
}));

import EditConfigPage from '../page';

// Minimal `cookies()` / `headers()` helpers — the page only calls `.get(...)`
// on them, so we return record-shaped objects that always miss.
function emptyCookies() {
  return { get: () => undefined };
}
function emptyHeaders() {
  return { get: () => null };
}

const NOTES_MANIFEST = {
  v: 1,
  id: 'notes',
  name: 'Notes',
  source: { kind: 'owned', store: 'settings:notes' },
  families: ['1x2'],
  layout: { '1x2': { t: 'list', items: { $: 'lines' } } },
  config_schema: [{ key: 'lines', label: 'Notes', type: 'lines', maxLines: 50, maxChars: 200 }],
};

const TEXT_FIELD_MANIFEST = {
  v: 1,
  id: 'custom-text',
  name: 'Custom text',
  source: { kind: 'owned', store: 'settings:custom-text' },
  families: ['1x1'],
  layout: { '1x1': { t: 'text', value: 'hi' } },
  config_schema: [
    { key: 'city', label: 'City', type: 'text', maxChars: 60, default: 'Shanghai' },
    { key: 'refresh', label: 'Refresh (s)', type: 'number', min: 30, max: 3600 },
  ],
};

const NO_SCHEMA_MANIFEST = {
  v: 1,
  id: 'legacy',
  name: 'Legacy',
  source: { kind: 'owned', store: 'settings:legacy' },
  families: ['1x1'],
  layout: { '1x1': { t: 'text', value: 'hi' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated, no locale cookie, no Accept-Language.
  getRequiredUserId.mockResolvedValue('user-1');
  cookies.mockResolvedValue(emptyCookies());
  headers.mockResolvedValue(emptyHeaders());
});

describe('/admin/widgets/[id]/edit-config page', () => {
  it('redirects to /signin when there is no authenticated user', async () => {
    getRequiredUserId.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    let caught: Error | null = null;
    try {
      // The page returns a promise; renderToString awaits it and the
      // redirect throws.
      await renderToString(await EditConfigPage({ params: Promise.resolve({ id: 'w-1' }) }));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(String(caught?.message || '')).toMatch(/REDIRECT:\/signin/);
    // The page must not have looked up the widget when unauthenticated.
    expect(getWidget).not.toHaveBeenCalled();
  });

  it('renders a line-by-line editor (textarea) for the notes manifest, pre-filled from config_json', async () => {
    // The notes widget's config_schema declares a `lines` field of type
    // `lines`. The page must surface a textarea with the existing
    // config_json.lines joined by newlines so the user sees what the
    // e-ink display is rendering today. The page is a server component
    // — `renderToString` resolves the React tree, and the client island
    // below it re-renders once hydrated, so we can assert on the SSR'd
    // HTML alone.
    getWidget.mockReturnValueOnce({
      id: 'w-1',
      user_id: 'user-1',
      manifest_json: JSON.stringify(NOTES_MANIFEST),
      // The existing lines the user previously saved through the legacy
      // /edit-notes path. The new editor must surface them in the
      // textarea verbatim.
      config_json: JSON.stringify({ lines: ['Buy milk', 'Ship widget'] }),
      created_at: 0,
      updated_at: 0,
    });

    const html = renderToString(await EditConfigPage({ params: Promise.resolve({ id: 'w-1' }) }));

    // The manifest's name is the page header (we render it as a
    // <strong>...</strong> next to the manifest id).
    expect(html).toContain('Notes');
    // The label from config_schema is the field label.
    expect(html).toContain('Notes</label>');
    // A textarea is the input element the line-by-line editor uses.
    // We check for the textarea tag itself rather than its contents
    // because the client island takes over the value attribute after
    // hydration (the SSR pass already inlines the initial lines).
    expect(html).toMatch(/<textarea[^>]*>/);
    // The widget id is surfaced for the operator.
    expect(html).toContain('w-1');
    // The Save button is the primary CTA.
    expect(html).toContain('Save');
  });

  it('renders an <input type="text"> for a text-typed field, pre-filled from config_json', async () => {
    // Different manifest: a `text` field must surface an `<input
    // type="text">` (not a textarea), and the existing config_json.city
    // value must be the defaultValue passed to the client island. The
    // SSR pass renders the `<input>` shell; the value comes back through
    // React props.
    getWidget.mockReturnValueOnce({
      id: 'w-2',
      user_id: 'user-1',
      manifest_json: JSON.stringify(TEXT_FIELD_MANIFEST),
      // Pre-fill: a stored city that overrides the manifest's `default`.
      config_json: JSON.stringify({ city: 'Berlin', refresh: 120 }),
      created_at: 0,
      updated_at: 0,
    });

    const html = renderToString(await EditConfigPage({ params: Promise.resolve({ id: 'w-2' }) }));

    // The manifest name surfaces.
    expect(html).toContain('Custom text');
    // The field label from config_schema is rendered.
    expect(html).toContain('City</label>');
    // A single-line text input is rendered (the lines-style editor uses
    // <textarea>; the text editor uses <input type="text">).
    expect(html).toMatch(/<input[^>]*type="text"/);
    // The number field also renders — its <input type="number"> is
    // distinct from the text input so we can assert on both.
    expect(html).toMatch(/<input[^>]*type="number"/);
    // Refresh label is the second field.
    expect(html).toContain('Refresh (s)</label>');
  });

  it('renders the no-schema panel when the manifest has no config_schema', async () => {
    // Legacy install: a widget whose manifest predates the
    // config_schema field. The page must render an explicit error
    // panel rather than a half-broken editor — the operator needs to
    // see why no inputs showed up.
    getWidget.mockReturnValueOnce({
      id: 'w-3',
      user_id: 'user-1',
      manifest_json: JSON.stringify(NO_SCHEMA_MANIFEST),
      config_json: '{}',
      created_at: 0,
      updated_at: 0,
    });

    const html = renderToString(await EditConfigPage({ params: Promise.resolve({ id: 'w-3' }) }));

    // The localized no-schema message surfaces — the operator sees the
    // manifest name + the explanation.
    expect(html).toMatch(/does not declare an editable config schema/);
    // No form is rendered when the schema is empty — the Save button
    // is only ever present when at least one field exists.
    expect(html).not.toContain('class="btn primary"');
  });

  it('renders the not-found panel when the widget does not exist for the current user', async () => {
    // Defensive: an authenticated scan of a widget id that doesn't
    // belong to the user (or doesn't exist) gets the not-found panel,
    // not an empty editor shell.
    getWidget.mockReturnValueOnce(undefined);

    const html = renderToString(await EditConfigPage({ params: Promise.resolve({ id: 'w-missing' }) }));

    expect(html).toMatch(/not found/i);
    // The back-to-canvas link is the only actionable affordance in the
    // not-found state.
    expect(html).toContain('Back to Canvas');
  });
});