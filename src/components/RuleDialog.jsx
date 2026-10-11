// v1.7: making or changing a smart list — a name, where its songs come from,
// the rules they must follow, the order and how many. While you write, it
// says how many songs the rules give right now and the first few.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { EMPTY_RULES, FROM, LIMITS, NUMBER_RULES, PRESETS, SORTS } from '../lib/ruleLists.js';
import { useLibrary } from '../store/library.js';
import { useUi } from '../store/ui.js';

/** `d`: { kind: 'rules', list? } — a list to change, or none to make a new one. */
export default function RuleDialog({ d }) {
  const close = useUi((s) => s.closeDialog);
  const editing = d.list || null;
  const [name, setName] = useState(editing ? editing.name : '');
  const [rules, setRules] = useState(editing ? { ...EMPTY_RULES, ...editing.rules } : { ...EMPTY_RULES, notHeardDays: 90 });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setRules((r) => ({ ...r, ...patch }));

  // How many songs these rules give now (a moment after the last change).
  const key = JSON.stringify(rules);
  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => {
      api.post('/api/rulelists/preview', { rules: JSON.parse(key) }).then((r) => { if (!gone) setPreview(r); }, () => { if (!gone) setPreview(null); });
    }, 250);
    return () => { gone = true; clearTimeout(t); };
  }, [key]);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const lib = useLibrary.getState();
      const l = editing ? await lib.updateRuleList(editing.id, { name, rules }) : await lib.createRuleList(name, rules);
      close();
      if (d.onSaved) d.onSaved(l);
      useUi.getState().go({ name: 'rules', id: l.id });
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <form className="dialog rule-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-title" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) close(); }}>
        <h2 id="rule-title">{editing ? 'Cambiar la lista inteligente' : 'Lista inteligente'}</h2>
        <p className="muted">Se hace con reglas sobre tu biblioteca y se pone al día sola cada vez que la abres. No busca nada fuera.</p>
        {!editing && (
          <div className="chips rule-presets" aria-label="Ideas">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" className="chip" title={p.hint} onClick={() => { setName(p.name); setRules({ ...p.rules }); }}>{p.name}</button>
            ))}
          </div>
        )}
        <label className="field">
          <span>Nombre</span>
          <input autoFocus type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Favoritas olvidadas" disabled={busy} />
        </label>
        <label className="field">
          <span>Canciones de</span>
          <select value={rules.from} onChange={(e) => set({ from: e.target.value })} disabled={busy}>
            {FROM.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <fieldset className="rule-rules" disabled={busy}>
          <legend>Que cumplan</legend>
          {NUMBER_RULES.map(([k, before, after, dflt]) => {
            const on = Number.isInteger(rules[k]);
            return (
              <div key={k} className={`rule-row ${on ? 'on' : ''}`}>
                <label className="rule-check">
                  <input type="checkbox" checked={on} onChange={(e) => set({ [k]: e.target.checked ? dflt : null })} />
                  <span>{before}</span>
                </label>
                <input type="number" className="rule-num" min={k.endsWith('Days') ? 1 : 0} max={k.endsWith('Days') ? 3650 : 10000} value={on ? rules[k] : dflt} disabled={!on}
                  aria-label={`${before} (${after})`} onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) set({ [k]: n }); }} />
                <span className="rule-after">{after}</span>
              </div>
            );
          })}
          <div className={`rule-row ${rules.artist ? 'on' : ''}`}>
            <label className="rule-check" htmlFor="rule-artist"><span>Artista o título con</span></label>
            <input id="rule-artist" type="text" className="rule-text" maxLength={100} value={rules.artist} placeholder="(cualquiera)" onChange={(e) => set({ artist: e.target.value })} />
          </div>
        </fieldset>
        <div className="rule-pair">
          <label className="field">
            <span>Orden</span>
            <select value={rules.sort} onChange={(e) => set({ sort: e.target.value })} disabled={busy}>
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Como mucho</span>
            <select value={rules.limit} onChange={(e) => set({ limit: Number(e.target.value) })} disabled={busy}>
              {LIMITS.map((n) => <option key={n} value={n}>{n} canciones</option>)}
            </select>
          </label>
        </div>
        <p className="rule-preview" aria-live="polite">
          {!preview ? 'Contando…' : !preview.count ? 'Ahora mismo ninguna canción cumple estas reglas.' : (
            <>
              <strong>Ahora: {Math.min(preview.count, rules.limit)} {Math.min(preview.count, rules.limit) === 1 ? 'canción' : 'canciones'}</strong>
              {preview.count > rules.limit && <span className="muted"> (de {preview.count})</span>}
              <span className="muted"> · {preview.songs.map((s) => s.title).join(', ')}{preview.count > preview.songs.length ? '…' : ''}</span>
            </>
          )}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-accent" disabled={busy || !name.trim()}>{editing ? 'Guardar' : 'Crear'}</button>
        </div>
      </form>
    </div>
  );
}
