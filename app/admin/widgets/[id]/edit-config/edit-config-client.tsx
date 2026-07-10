'use client';

/**
 * Generic dynamic editor for any widget that declares a `config_schema`.
 *
 * One input is rendered per `ConfigField`. The component is intentionally
 * dumb about widget identity: it just sends whatever the user typed to
 * `/api/widgets/[id]/config`. The server validates the body against the
 * manifest's `config_schema`, so this component can never write a field
 * the manifest didn't declare — there's no client-side allowlist to keep
 * in sync.
 *
 * Visual feedback (counters, over-limit warnings) mirrors the legacy
 * notes editor so the experience is consistent regardless of which
 * widget the user is editing.
 */

import { useMemo, useState } from 'react';
import { t, type Locale } from '@/lib/i18n';
import type { ConfigField } from '@/lib/widgets/ir';

interface EditConfigClientProps {
  widgetId: string;
  fields: ConfigField[];
  initialValues: Record<string, unknown>;
  locale: Locale;
}

export default function EditConfigClient({
  widgetId,
  fields,
  initialValues,
  locale,
}: EditConfigClientProps) {
  // Local form state — keyed by `field.key`. Each input mutates its own
  // entry; on save we serialize the full set and POST it. The server's
  // strict zod schema rejects unknown keys (none here, since every input
  // maps to a declared field) and unknown-value types.
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  function setField(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  // Pre-compute the per-field validity so we can disable the save button
  // when the form contains a value the server will reject. We mirror the
  // server's checks (string lengths, array lengths, number min/max) so
  // the user notices before they click save.
  const issues = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'text' || f.type === 'multiline') {
        const s = typeof v === 'string' ? v : '';
        if (typeof f.maxChars === 'number' && s.length > f.maxChars) {
          out[f.key] = t(locale, 'admin.editConfig.err.tooLong', { len: f.maxChars });
          continue;
        }
      }
      if (f.type === 'lines') {
        const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        const maxChars = typeof f.maxChars === 'number' ? f.maxChars : 1000;
        const maxLines = typeof f.maxLines === 'number' ? f.maxLines : 100;
        if (arr.length > maxLines) {
          out[f.key] = t(locale, 'admin.editConfig.err.tooManyLines', { max: maxLines });
          continue;
        }
        if (arr.some((l) => l.length > maxChars)) {
          out[f.key] = t(locale, 'admin.editConfig.err.lineTooLong', { len: maxChars });
          continue;
        }
      }
      if (f.type === 'number' && typeof v === 'number') {
        if (typeof f.min === 'number' && v < f.min) {
          out[f.key] = t(locale, 'admin.editConfig.err.min', { min: f.min });
          continue;
        }
        if (typeof f.max === 'number' && v > f.max) {
          out[f.key] = t(locale, 'admin.editConfig.err.max', { max: f.max });
          continue;
        }
      }
      out[f.key] = null;
    }
    return out;
  }, [fields, locale, values]);

  const hasIssues = Object.values(issues).some((v) => v != null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (hasIssues) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/widgets/${encodeURIComponent(widgetId)}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(typeof j.error === 'string' ? j.error : `HTTP ${r.status}`);
      }
      setStatus({ kind: 'ok', msg: t(locale, 'admin.editConfig.status.saved') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: 'err', msg: t(locale, 'admin.editConfig.status.saveFailed', { message: msg }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel">
      {fields.map((f) => (
        <FieldRow
          key={f.key}
          field={f}
          value={values[f.key]}
          onChange={(v) => setField(f.key, v)}
          issue={issues[f.key]}
          locale={locale}
        />
      ))}

      {status && (
        <div className={status.kind === 'ok' ? 'ok' : 'err'} style={{ marginTop: 0 }}>
          {status.msg}
        </div>
      )}

      <button className="btn primary" type="submit" disabled={busy || hasIssues}>
        {busy ? t(locale, 'admin.editConfig.saving') : t(locale, 'admin.editConfig.save')}
      </button>
    </form>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  issue,
  locale,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
  issue: string | null;
  locale: Locale;
}) {
  const id = `cfg-${field.key}`;
  const labelEl = (
    <label className="label" htmlFor={id}>
      {field.label}
    </label>
  );

  // `lines` is special: the textarea's native value is a string, but the
  // server's schema expects `string[]`. We render the same textarea
  // surface the legacy notes editor used, then parse-on-change so the
  // form state matches the wire shape.
  if (field.type === 'lines') {
    const initial = Array.isArray(value)
      ? value.filter((x): x is string => typeof x === 'string')
      : [];
    const maxChars = typeof field.maxChars === 'number' ? field.maxChars : 1000;
    const maxLines = typeof field.maxLines === 'number' ? field.maxLines : 100;
    return (
      <div className="field">
        {labelEl}
        <LinesTextarea
          id={id}
          initial={initial}
          maxChars={maxChars}
          maxLines={maxLines}
          onChange={onChange}
        />
        <div className="hint">
          {t(locale, 'admin.editConfig.counter.lines', { count: initial.length, max: maxLines, len: maxChars })}
        </div>
        {field.hint ? <div className="hint">{field.hint}</div> : null}
        {issue ? <div className="err">{issue}</div> : null}
      </div>
    );
  }

  let control: React.ReactNode = null;
  let counter: React.ReactNode = null;

  switch (field.type) {
    case 'text': {
      const v = typeof value === 'string' ? value : '';
      control = (
        <input
          id={id}
          type="text"
          value={v}
          placeholder={field.placeholder}
          maxLength={field.maxChars}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '100%' }}
        />
      );
      if (typeof field.maxChars === 'number') {
        counter = (
          <div className="hint">
            {t(locale, 'admin.editConfig.counter.chars', { count: v.length, max: field.maxChars })}
          </div>
        );
      }
      break;
    }
    case 'multiline': {
      const v = typeof value === 'string' ? value : '';
      control = (
        <textarea
          id={id}
          value={v}
          placeholder={field.placeholder}
          rows={6}
          maxLength={field.maxChars}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }}
          spellCheck={false}
        />
      );
      if (typeof field.maxChars === 'number') {
        counter = (
          <div className="hint">
            {t(locale, 'admin.editConfig.counter.chars', { count: v.length, max: field.maxChars })}
          </div>
        );
      }
      break;
    }
    case 'number': {
      const v = typeof value === 'number' ? value : '';
      const asStr = v === '' ? '' : String(v);
      control = (
        <input
          id={id}
          type="number"
          value={asStr}
          min={field.min}
          max={field.max}
          onChange={(e) => {
            const s = e.target.value;
            if (s === '') {
              onChange(null);
              return;
            }
            const n = Number(s);
            onChange(Number.isFinite(n) ? n : s);
          }}
          style={{ width: '100%' }}
        />
      );
      break;
    }
    case 'boolean': {
      const v = value === true;
      control = (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            id={id}
            type="checkbox"
            checked={v}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            {v ? t(locale, 'admin.editConfig.bool.on') : t(locale, 'admin.editConfig.bool.off')}
          </span>
        </label>
      );
      break;
    }
  }

  return (
    <div className="field">
      {labelEl}
      {control}
      {counter}
      {field.hint ? <div className="hint">{field.hint}</div> : null}
      {issue ? <div className="err">{issue}</div> : null}
    </div>
  );
}

/**
 * `lines` is the only field whose raw state is a string (the textarea
 * value) but whose serialized wire shape is `string[]`. We keep the
 * local state as an array and re-join on render so the input behaves
 * like a normal textarea (caret position, undo, etc).
 */
function LinesTextarea({
  id,
  initial,
  maxChars,
  maxLines,
  onChange,
}: {
  id: string;
  initial: string[];
  maxChars: number;
  maxLines: number;
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(initial.join('\n'));
  return (
    <textarea
      id={id}
      value={text}
      rows={Math.min(12, Math.max(4, initial.length + 1))}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const arr = next
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .slice(0, maxLines);
        // Always emit the parsed array. The server's `lines` schema
        // expects `string[]`; the editor never sends the raw textarea
        // string. `maxChars` per-line enforcement happens upstream via
        // the `issues` memo in the parent.
        void maxChars;
        onChange(arr);
      }}
      style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }}
      spellCheck={false}
    />
  );
}