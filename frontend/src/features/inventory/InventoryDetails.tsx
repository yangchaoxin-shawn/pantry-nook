import { useEffect, useState } from "react";
import { api, type Ingredient, type InventoryAdjustmentRecord } from "../../shared/api/client";
import { Empty, Field } from "../../shared/ui/Primitives";
import { stockLabel } from "./inventory-format";
import { QuantityInput } from "../../shared/ui/QuantityInput";
import { quantityInputError } from "../../shared/ui/quantity-input-logic";
import {
  groupInventoryAdjustmentRecords,
  inventoryAdjustmentAmountLabel,
  inventoryAdjustmentMomentLabel,
  inventoryAdjustmentTimeLabel,
  readInventoryAdjustmentLedger,
  type InventoryAdjustmentLedgerState,
} from "./inventory-adjustment-ledger";
import "./inventory-adjustment-ledger.css";

export function IngredientDetail({ item, busy, edit, waste }: { item: Ingredient; busy: boolean; edit: () => void; waste: () => void }) {
  return <div className="ingredient-detail">
    <dl className="detail-grid">
      <div><dt>分类</dt><dd>{item.category}</dd></div>
      <div><dt>当前库存</dt><dd>{stockLabel(item)}</dd></div>
      <div><dt>存放位置</dt><dd>{item.location || <>未填写 <button type="button" className="text-button" onClick={edit} disabled={busy}>补充位置</button></>}</dd></div>
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
  const quantityError = quantityInputError(quantity, { required: true, max: item.stock_value });
  const invalid = Boolean(quantityError);
  return <form onSubmit={(event) => { event.preventDefault(); if (!invalid) save({ stock_text: quantity, stock_value: amount, stock_unit: item.stock_unit, reason, note: String(new FormData(event.currentTarget).get("note") || "") || null, expected_updated_at: item.updated_at }); }}>
    <p className="dialog-description">当前库存 {stockLabel(item)}。处理后可在“库存处理记录”里查看。</p>
    <div className="unit-choice"><button type="button" className={all ? "chip active" : "chip"} onClick={() => { setAll(true); setQuantity(String(item.stock_value)); }}>全部处理</button><button type="button" className={!all ? "chip active" : "chip"} onClick={() => setAll(false)}>处理部分</button></div>
    <QuantityInput label={`处理数量（${item.stock_unit}）`} required disabled={all || busy} max={item.stock_value} value={quantity} onValueChange={setQuantity} />
    {!all && <p className="form-hint">数量每次增减 1，也可直接输入小数。</p>}
    <Field label="原因"><select value={reason} onChange={event => setReason(event.target.value as typeof reason)}>{Object.entries(wasteReasonText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
    <Field label="备注（选填）"><textarea name="note" rows={2} maxLength={5000} placeholder="例如：冷藏失温" /></Field>
    {invalid && <p className="form-error">{quantityError}</p>}
    <button className="btn-primary submit" disabled={busy || invalid}>{busy ? "处理中…" : "确认处理"}</button>
  </form>;
}

export function InventoryAdjustmentLedger({ busy, refreshKey, revoke }: { busy: boolean; refreshKey: number; revoke: (id: number) => void }) {
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${refreshKey}:${retryKey}`;
  const [result, setResult] = useState<{ key: string; state: InventoryAdjustmentLedgerState }>({
    key: "",
    state: { status: "loading" },
  });
  useEffect(() => {
    let alive = true;
    void readInventoryAdjustmentLedger(() => api.inventoryAdjustments())
      .then((next) => { if (alive) setResult({ key: requestKey, state: next }); });
    return () => { alive = false; };
  }, [requestKey]);
  const state: InventoryAdjustmentLedgerState = result.key === requestKey ? result.state : { status: "loading" };
  if (state.status === "error") return <section className="pn-adjustment-ledger-state pn-adjustment-ledger-state--error" role="alert">
    <span className="pn-adjustment-ledger-state-mark" aria-hidden="true">!</span>
    <div><p className="pn-adjustment-ledger-kicker">记录簿暂时合上了</p><h2>没能打开处理记录</h2><p>{state.message}</p></div>
    <button type="button" className="btn-primary" onClick={() => setRetryKey((value) => value + 1)}>重新读取</button>
  </section>;
  if (state.status === "loading") return <div className="pn-adjustment-ledger-state pn-adjustment-ledger-state--loading" role="status">
    <span className="pn-adjustment-ledger-pulse" aria-hidden="true" />
    <div><p className="pn-adjustment-ledger-kicker">正在翻找</p><p>正在读取库存处理记录…</p></div>
  </div>;
  const records = state.records;
  if (!records.length) return <section className="pn-adjustment-ledger-empty">
    <div className="pn-adjustment-ledger-empty-date" aria-hidden="true"><span>—</span><strong>空</strong></div>
    <Empty title="这本记录簿还是空的">变质或损坏处理会按发生时间留在这里。</Empty>
  </section>;
  const active = records.filter((record) => record.status === "active");
  const reversed = records.filter((record) => record.status === "reversed");
  const renderRecord = (record: InventoryAdjustmentRecord) => {
    const titleId = `adjustment-record-${record.id}`;
    return <article className={`pn-adjustment-record pn-adjustment-record--${record.status}`} key={record.id} aria-labelledby={titleId}>
      <div className="pn-adjustment-record-time">
        <time dateTime={record.created_at}>{inventoryAdjustmentTimeLabel(record.created_at)}</time>
        <span aria-hidden="true" />
      </div>
      <div className="pn-adjustment-record-sheet">
        <header>
          <div className="pn-adjustment-record-title">
            <span className="pn-adjustment-record-reason">{wasteReasonText[record.reason]}</span>
            <h4 id={titleId}>{record.ingredient_name}</h4>
          </div>
          <span className={`pn-adjustment-record-status pn-adjustment-record-status--${record.status}`}>{record.status === "active" ? "可撤销" : "已撤销"}</span>
        </header>
        <div className="pn-adjustment-record-quantity" aria-label={`本次处理数量${inventoryAdjustmentAmountLabel(record)}`}>
          <span>本次处理</span>
          <strong>{inventoryAdjustmentAmountLabel(record)}</strong>
        </div>
        {record.note && <p className="pn-adjustment-record-note"><span>备注</span>{record.note}</p>}
        {record.status === "active" ? <div className="pn-adjustment-record-action">
          <span>处理仍可安全撤回</span>
          <button className="btn-primary" disabled={busy} onClick={() => revoke(record.id)} aria-label={`撤销${record.ingredient_name}的${wasteReasonText[record.reason]}处理`}>撤销处理</button>
        </div> : <div className="pn-adjustment-record-reversal">
          <p>{record.reversed_at ? <><time dateTime={record.reversed_at}>{inventoryAdjustmentMomentLabel(record.reversed_at)}</time> 已撤销</> : "已撤销"}</p>
          {record.recovery_merges?.map(merge => <p key={merge.id}>恢复数量已合并到<strong>{merge.target_name}</strong>，合并后 {merge.target_after_value}{merge.target_after_unit}</p>)}
        </div>}
      </div>
    </article>;
  };
  const renderGroups = (source: InventoryAdjustmentRecord[], lane: "active" | "history") => groupInventoryAdjustmentRecords(source).map((group) => <section className="pn-adjustment-day" key={group.key} aria-labelledby={`adjustment-${lane}-day-${group.key}`}>
    <h3 id={`adjustment-${lane}-day-${group.key}`}>{group.label}</h3>
    <div className="pn-adjustment-day-records">{group.records.map(renderRecord)}</div>
  </section>);
  return <div className="pn-adjustment-ledger" aria-busy={busy || undefined}>
    <header className="pn-adjustment-ledger-overview">
      <div><p className="pn-adjustment-ledger-kicker">库存处理时间线</p><h2>每一次处理，都有来处</h2><p>按发生时间留档；仍可撤销的记录放在前面，方便及时找回。</p></div>
      <dl>
        <div><dt>仍可撤销</dt><dd>{active.length}</dd></div>
        <div><dt>已撤销</dt><dd>{reversed.length}</dd></div>
      </dl>
    </header>
    <div className={`pn-adjustment-ledger-lanes${reversed.length ? "" : " pn-adjustment-ledger-lanes--single"}`}>
      <section className="pn-adjustment-ledger-lane pn-adjustment-ledger-lane--active" aria-labelledby="active-adjustments-heading">
        <header><div><p>NOW / 现在</p><h2 id="active-adjustments-heading">仍可撤销</h2></div><span>{active.length} 条</span></header>
        {active.length ? renderGroups(active, "active") : <p className="pn-adjustment-ledger-lane-empty">目前没有可撤销的处理。</p>}
      </section>
      {reversed.length > 0 && <section className="pn-adjustment-ledger-lane pn-adjustment-ledger-lane--history" aria-labelledby="reversed-adjustments-heading">
        <header><div><p>ARCHIVE / 归档</p><h2 id="reversed-adjustments-heading">已经撤销</h2></div><span>{reversed.length} 条</span></header>
        {renderGroups(reversed, "history")}
      </section>}
    </div>
  </div>;
}
