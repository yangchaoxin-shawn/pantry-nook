import { useEffect, useRef, useState } from 'react';
import { api, type RecoveryPreview, type RecoveryRequest } from './api';
import { canConvertUnits } from './batch-ingredient-logic';

const factors: Record<string, number> = { g: 1, kg: 1000, 斤: 500, ml: 1, L: 1000 };
const converted = (value: number, from: string, to: string) => from === to ? value : value * factors[from] / factors[to];

export type RecoveryDraft = { units: Record<number, string>; totals: Record<number, string> };

export function RecoveryDialog({ kind, id, draft, onDraft, onPending, onSuccess }: {
  kind: 'adjustment' | 'battle'; id: number; onPending: (pending: boolean) => void; onSuccess: () => void;
  draft?: RecoveryDraft; onDraft: (draft: RecoveryDraft) => void;
}) {
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [units, setUnits] = useState<Record<number, string>>(draft?.units ?? {});
  const [totals, setTotals] = useState<Record<number, string>>(draft?.totals ?? {});
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    api.recoveryPreview(kind, id, controller.signal).then(({ data }) => {
      if (controller.signal.aborted) return;
      setPreview(data); setError(''); setNeedsRefresh(false);
      setUnits(current => Object.fromEntries(data.items.filter(r => r.target_ingredient_id !== null).map(r => [r.source_ingredient_id,
        [r.restored_unit, r.target_unit].includes(current[r.source_ingredient_id]) ? current[r.source_ingredient_id] : r.target_unit!])));
    }).catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '读取失败'); setNeedsRefresh(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, id, revision]);
  const merges = preview?.items.filter(r => r.target_ingredient_id !== null) ?? [];
  const invalid = merges.some(r => !canConvertUnits(r.restored_unit, r.target_unit) &&
    (!Number.isFinite(Number(totals[r.source_ingredient_id])) || Number(totals[r.source_ingredient_id]) <= 0));
  async function submit() {
    if (!preview || busy || loading || needsRefresh || invalid || lock.current) return;
    lock.current = true; setBusy(true); onPending(true); setError('');
    const body: RecoveryRequest = { expected_updated_at: preview.expected_updated_at,
      merge_resolutions: merges.map(r => ({ source_ingredient_id: r.source_ingredient_id, source_updated_at: r.source_updated_at,
        target_ingredient_id: r.target_ingredient_id!, target_updated_at: r.target_updated_at!, stock_unit: units[r.source_ingredient_id],
        ...(!canConvertUnits(r.restored_unit, r.target_unit) ? { final_stock_text: totals[r.source_ingredient_id].trim(), final_stock_value: Number(totals[r.source_ingredient_id]) } : {}),
      })) };
    try { await api.recover(kind, id, body); onSuccess(); }
    catch (e) { setError(e instanceof Error ? e.message : '撤销失败'); setNeedsRefresh(true); }
    finally { lock.current = false; setBusy(false); onPending(false); }
  }
  return <div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p role="status">正在核对可恢复的库存…</p> : <>
      {preview?.items.map(r => {
        const unit = units[r.source_ingredient_id] || r.target_unit || r.restored_unit;
        const automatic = canConvertUnits(r.restored_unit, r.target_unit);
        const total = r.target_value !== null && r.target_unit && automatic
          ? converted(r.target_value, r.target_unit, unit) + converted(r.restored_value, r.restored_unit, unit) : null;
        return <fieldset key={r.source_ingredient_id}><legend>{r.name}</legend>
          <p>本次恢复 {r.restored_value}{r.restored_unit}</p>
          {r.target_ingredient_id !== null ? <>
            <p>当前库存 {r.target_value}{r.target_unit}，恢复后合并到这一条库存。</p>
            <label>合并单位<select aria-label={`${r.name}合并单位`} value={unit} disabled={busy} onChange={e => { const next = { ...units, [r.source_ingredient_id]: e.target.value }; setUnits(next); onDraft({ units: next, totals }); }}>
              {[...new Set([r.target_unit!, r.restored_unit])].map(u => <option key={u}>{u}</option>)}</select></label>
            {total !== null ? <p>合并后：{total.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}{unit}</p>
              : <label>合并后的实际数量（{unit}）<input aria-label={`${r.name}合并后的实际数量`} type="number" min="0.000001" step="0.000001" inputMode="decimal" disabled={busy}
                value={totals[r.source_ingredient_id] ?? ''} onChange={e => { const next = { ...totals, [r.source_ingredient_id]: e.target.value }; setTotals(next); onDraft({ units, totals: next }); }} /><span className="form-hint">单位不能自动换算，请按实际库存填写最终量。</span></label>}
          </> : <p className="muted">恢复到原库存记录。</p>}
        </fieldset>;
      })}
      {kind === 'battle' && merges.length > 0 && <p className="form-hint">菜单将回到待完成。合并涉及的用量需要重新填写并核对。</p>}
      {needsRefresh ? <button className="btn-ghost" disabled={busy} onClick={() => { setLoading(true); setRevision(v => v + 1); }}>刷新预览并重新核对</button>
        : <button className="btn-primary" disabled={!preview || busy || invalid} onClick={() => void submit()}>{busy ? '正在恢复…' : merges.length ? '确认合并撤销' : '确认撤销'}</button>}
    </>}
  </div>;
}
