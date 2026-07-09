'use client';

/**
 * Client-side editor for a notes widget. Two-way bound textarea (one note
 * per line), a save button that POSTs to `/api/widgets/[id]/config`, and a
 * live character / line counter so the user sees the constraints before
 * the server rejects them.
 *
 * The textarea holds a single string with newlines; we split on save so the
 * user can paste a multi-line block without us needing to glue N textareas
 * together. Splitting on save is also how we enforce the "no empty lines"
 * rule the Source layer applies — the server sees the same `lines[]` shape
 * it stores and renders.
 */

import { useMemo, useState } from 'react';

const MAX_LINES = 50;
const MAX_LINE_LEN = 200;

export default function EditNotesClient({
  widgetId,
  initialLines,
}: {
  widgetId: string;
  initialLines: string[];
}) {
  const [text, setText] = useState(initialLines.join('\n'));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Live preview of the lines the server will see after save. Mirrors the
  // server's parsing rules (drop empties, coerce to string) so the user
  // notices when their blank lines would be silently dropped.
  const previewLines = useMemo(
    () =>
      text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, MAX_LINES),
    [text],
  );

  // Cheap per-line length check; highlight rows the server will reject.
  const tooLong = useMemo(() => previewLines.some((l) => l.length > MAX_LINE_LEN), [previewLines]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/widgets/${encodeURIComponent(widgetId)}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: previewLines }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(typeof j.error === 'string' ? j.error : `HTTP ${r.status}`);
      }
      setStatus({ kind: 'ok', msg: `已保存 ${previewLines.length} 行` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: 'err', msg: '保存失败: ' + msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel">
      <div className="field">
        <label className="label" htmlFor="notes-ta">
          笔记（每行一条）
        </label>
        <textarea
          id="notes-ta"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }}
          spellCheck={false}
        />
        <div className="hint">
          {previewLines.length} / {MAX_LINES} 行 · 每行 ≤ {MAX_LINE_LEN} 字符
          {tooLong ? (
            <span style={{ color: '#a00', fontWeight: 700 }}> · 有行超过 {MAX_LINE_LEN} 字符，保存将被拒绝</span>
          ) : null}
        </div>
      </div>

      {status && (
        <div className={status.kind === 'ok' ? 'ok' : 'err'} style={{ marginTop: 0 }}>
          {status.msg}
        </div>
      )}

      <button className="btn primary" type="submit" disabled={busy || tooLong || previewLines.length === 0}>
        {busy ? '保存中…' : '保存'}
      </button>
      <button
        type="button"
        className="btn"
        style={{ marginLeft: 8 }}
        onClick={() => setText('')}
        disabled={busy}
        title="清空（不会自动保存）"
      >
        清空
      </button>
    </form>
  );
}