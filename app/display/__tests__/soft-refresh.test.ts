/**
 * Tests for the soft-refresh DOM patch step. We use a minimal hand-rolled DOM
 * (no jsdom dependency — it's not installed and we don't pull a full parser
 * for five attribute-selector cases). The shape matches the DisplayNode
 * interface that `patchDisplayRoot` accepts.
 */
import { describe, it, expect } from 'vitest';
import { patchDisplayRoot, type DisplayNode, EINK_UA_PATTERN } from '../soft-refresh';

// --- Minimal fake DOM -------------------------------------------------------

interface FakeEl extends DisplayNode {
  tag: string;
  attrs: Record<string, string>;
  children: FakeEl[];
  setAttribute(name: string, value: string): void;
}

function el(tag: string, attrs: Record<string, string> = {}, children: FakeEl[] = []): FakeEl {
  const node = {
    tag,
    attrs: { ...attrs },
    children,
    innerHTML: '',
    textContent: null as string | null,
    getAttribute(this: FakeEl, name: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute(this: FakeEl, name: string, value: string) {
      this.attrs[name] = value;
    },
    querySelector(this: FakeEl, sel: string): FakeEl | null {
      const all = this.querySelectorAll(sel) as FakeEl[];
      return all.length ? all[0] : null;
    },
    querySelectorAll(this: FakeEl, sel: string): FakeEl[] {
      const out: FakeEl[] = [];
      const walk = (n: FakeEl) => {
        if (matches(n, sel)) out.push(n);
        for (const c of n.children) walk(c);
      };
      walk(this);
      return out;
    },
  };
  return node as unknown as FakeEl;
}

// Supports the five selectors the patcher actually issues:
//   [data-X]            presence
//   [data-X="value"]    equality (value is unquoted; matches the regex we use)
function matches(node: FakeEl, sel: string): boolean {
  const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if (!m) return false;
  const attr = m[1];
  const val = m[2];
  if (!Object.prototype.hasOwnProperty.call(node.attrs, attr)) return false;
  if (val === undefined) return true;
  return node.attrs[attr] === val;
}

// --- Tests ------------------------------------------------------------------

describe('patchDisplayRoot — F3 fix', () => {
  it('replaces a [data-w-inst] node by its key', () => {
    const oldNode = el('div', { 'data-w-inst': 'i0' }, []);
    oldNode.innerHTML = '<span>old</span>';
    const oldRoot = el('div', { 'data-display-root': '' }, [oldNode]);

    const newNode = el('div', { 'data-w-inst': 'i0' }, []);
    newNode.innerHTML = '<span>new</span>';
    const newRoot = el('div', { 'data-display-root': '' }, [newNode]);

    patchDisplayRoot(oldRoot, newRoot);

    expect(oldNode.innerHTML).toBe('<span>new</span>');
  });

  it('replaces a [data-pid] node by its key (legacy provider view)', () => {
    const oldNode = el('div', { 'data-pid': 'openai' }, []);
    oldNode.innerHTML = '<p>used 50%</p>';
    const oldRoot = el('div', { 'data-display-root': '' }, [oldNode]);

    const newNode = el('div', { 'data-pid': 'openai' }, []);
    newNode.innerHTML = '<p>used 73%</p>';
    const newRoot = el('div', { 'data-display-root': '' }, [newNode]);

    patchDisplayRoot(oldRoot, newRoot);

    expect(oldNode.innerHTML).toBe('<p>used 73%</p>');
  });

  it('skips silently when the new doc references a key the old doc does not have', () => {
    const oldNode = el('div', { 'data-w-inst': 'i0' }, []);
    const oldOriginal = '<span>keep me</span>';
    oldNode.innerHTML = oldOriginal;
    const oldRoot = el('div', { 'data-display-root': '' }, [oldNode]);

    const newNode = el('div', { 'data-w-inst': 'ghost' }, []);
    newNode.innerHTML = '<span>nowhere</span>';
    const newRoot = el('div', { 'data-display-root': '' }, [newNode]);

    expect(() => patchDisplayRoot(oldRoot, newRoot)).not.toThrow();
    expect(oldNode.innerHTML).toBe(oldOriginal);
  });

  it('patches only the matching instance and leaves siblings alone', () => {
    const oldA = el('div', { 'data-w-inst': 'a' }, []);
    oldA.innerHTML = 'A-old';
    const oldB = el('div', { 'data-w-inst': 'b' }, []);
    oldB.innerHTML = 'B-old';
    const oldRoot = el('div', { 'data-display-root': '' }, [oldA, oldB]);

    const newA = el('div', { 'data-w-inst': 'a' }, []);
    newA.innerHTML = 'A-new';
    const newRoot = el('div', { 'data-display-root': '' }, [newA]);

    patchDisplayRoot(oldRoot, newRoot);

    expect(oldA.innerHTML).toBe('A-new');
    expect(oldB.innerHTML).toBe('B-old');
  });

  it('copies [data-updated-at] textContent when present in both docs', () => {
    const oldUpdated = el('div', { 'data-updated-at': '' }, []);
    oldUpdated.textContent = 'old ts';
    const oldRoot = el('div', { 'data-display-root': '' }, [oldUpdated]);

    const newUpdated = el('div', { 'data-updated-at': '' }, []);
    newUpdated.textContent = 'new ts';
    const newRoot = el('div', { 'data-display-root': '' }, [newUpdated]);

    patchDisplayRoot(oldRoot, newRoot);

    expect(oldUpdated.textContent).toBe('new ts');
  });
});

// --- F8: e-ink UA detection --------------------------------------------------
// The full allow/deny list is best-effort — see the comment on
// EINK_UA_PATTERN — but we lock down the known common cases so a regex edit
// that breaks an obvious match (Kindle / Kobo / PocketBook) is caught.

describe('EINK_UA_PATTERN — F8', () => {
  // e-ink readers: must match
  it('matches a Kindle UA', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (X11; U; Linux armv7l like Maemo; en-US) AppleWebKit/534.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2 Kindle/3.0+'),
    ).toBe(true);
  });

  it('matches a Kobo UA (Libra / Clara / Sage / Elipsa share the Kobo token)', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Kobo/4.0'),
    ).toBe(true);
  });

  it('matches a PocketBook UA', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (Linux; U; Android 4.0.4; en-us; PocketBook Touch 2 build/...)'),
    ).toBe(true);
  });

  it('matches an Onyx BOOX UA via the "Onyx" token (covers rebrands)', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (Linux; Android 11; Onyx BOOX Poke5 Build/RP1A.201005.001)'),
    ).toBe(true);
  });

  it('matches a Xiaomi MiReader UA', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (Linux; U; Android 4.4.2; zh-cn; MiReader Build/KOT49H)'),
    ).toBe(true);
  });

  // normal browsers: must NOT match
  it('does not match desktop Chrome', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'),
    ).toBe(false);
  });

  it('does not match desktop Safari', () => {
    expect(
      EINK_UA_PATTERN.test('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'),
    ).toBe(false);
  });
});