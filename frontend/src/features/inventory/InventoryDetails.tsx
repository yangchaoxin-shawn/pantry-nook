import { useEffect, useState } from "react";
import { api, type Ingredient, type InventoryAdjustmentRecord } from "../../shared/api/client";
import { Empty, Field } from "../../shared/ui/Primitives";
import { stockLabel } from "./inventory-format";

export function IngredientDetail({ item, busy, edit, waste }: { item: Ingredient; busy: boolean; edit: () => void; waste: () => void }) {
  return <div className="ingredient-detail">
    <dl className="detail-grid">
      <div><dt>分类</dt><dd>{item.category}</dd></div>
      <div><dt>当前库存</dt><dd>{stockLabel(item)}</dd></div>
      {item.location && <div><dt>存放位置</dt><dd>{item.location}</dd></div>}
    </dl>
    {item.note && <div className="detail-note"><h4>备注</h4><p>{item.note}</p></div>}
    <div className="actions ingredient-detail-actions"><button className="btn-ghost" onClick={edit} disabled={busy}>编辑</button><button className="text-button danger" onClick={waste} disabled={busy}>处理变质/损坏</button></div>
  </div>;
}

const wasteReasonText = { spoiled: "变质", damaged: "损坏", other: "其他" } as const;

export function WasteEditor({ item, busy, save }: { item: Ingredient; busy: boolean; save: (payload: Parameters<typeof api.wasteIngredient>[1]) => void }) {
  const [all, setAll] = useState(true);
  const [quantity, setQuantity] = useState(String(item.stock_value));
  const [reason, setReason] = useState<"spoiled" | "damaged" | "other">("spoiled");
  const amount = Number(quantity);
  const invalid = !Number.isFinite(amount) || amount <= 0 || amount > item.stock_value;
  return <form onSubmit={(event) => { event.preventDefault(); if (!invalid) save({ stock_text: quantity, stock_value: amount, stock_unit: item.stock_unit, reason, note: String(new FormData(event.currentTarget).get("note") || "") || null, expected_updated_at: item.updated_at }); }}>
    <p className="dialog-description">当前库存 {stockLabel(item)}。处理后可在“库存处理记录”里查看。</p>
    <div className="unit-choice"><button type="button" className={all ? "chip active" : "chip"} onClick={() => { setAll(true); setQuantity(String(item.stock_value)); }}>全部处理</button><button type="button" className={!all ? "chip active" : "chip"} onClick={() => setAll(false)}>处理部分</button></div>
    <Field label={`处理数量（${item.stock_unit}）`}><input required disabled={all} type="number" min="0.000001" max={item.stock_value} step="0.000001" inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>
    <Field label="原因"><select value={reason} onChange={event => setReason(event.target.value as typeof reason)}>{Object.entries(wasteReasonText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
    <Field label="备注（选填）"><textarea name="note" rows={2} maxLength={5000} placeholder="例如：冷藏失温" /></Field>
    {invalid && <p className="form-error">处理数量应大于 0，且不能超过当前库存。</p>}
    <button className="btn-primary submit" disabled={busy || invalid}>{busy ? "处理中…" : "确认处理"}</button>
  </form>;
}

export function InventoryAdjustmentLedger({ busy, refreshKey, revoke }: { busy: boolean; refreshKey: number; revoke: (id: number) => void }) {
  const [records, setRecords] = useState<InventoryAdjustmentRecord[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.inventoryAdjustments().then((response) => alive && setRecords(response)).catch((cause) => alive && setError(cause instanceof Error ? cause.message : "读取失败"));
    return () => { alive = false; };
  }, [refreshKey]);
  if (error) return <section className="card error-state" role="alert"><p>{error}</p></section>;
  if (!records) return <p className="muted">正在读取库存处理记录…</p>;
  if (!records.length) return <Empty title="还没有库存处理记录">变质或损坏处理会出现在这里。</Empty>;
  const label = (text: string, unit: string) => text.includes(unit) ? text : `${text}${unit}`;
  const render = (record: InventoryAdjustmentRecord) => <article className="list-row adjustment-ledger-row" key={record.id}>
    <div><strong>{record.ingredient_name} · {wasteReasonText[record.reason]}</strong><p className="muted">{label(record.stock_before_text, record.stock_before_unit)} → {label(record.stock_after_text, record.stock_after_unit)}{record.note ? ` · ${record.note}` : ""}</p></div>
    {record.status === "active" ? <button className="btn-primary" disabled={busy} onClick={() => revoke(record.id)}>撤销处理</button> : <span className="muted">已撤销{record.recovery_merges?.map(merge => <span key={merge.id}> · 已合并恢复到{merge.target_name}（{merge.target_after_value}{merge.target_after_unit}）</span>)}</span>}
  </article>;
  const active = records.filter((record) => record.status === "active");
  const reversed = records.filter((record) => record.status === "reversed");
  return <div className="adjustment-ledger">
    <section className="card"><div className="section-heading"><h2>可撤销处理</h2><span className="muted">{active.length} 条</span></div>{active.length ? active.map(render) : <p className="muted">没有可撤销的处理。</p>}</section>
    {reversed.length > 0 && <section className="card"><div className="section-heading"><h2>处理历史</h2><span className="muted">{reversed.length} 条</span></div>{reversed.map(render)}</section>}
  </div>;
}
