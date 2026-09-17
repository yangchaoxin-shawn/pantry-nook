import { useEffect, useState } from "react";
import { api, type Ingredient, type InventoryAdjustmentKind, type InventoryAdjustmentRecord } from "../../shared/api/client";
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
import { casualUseAll, casualUseHalf, casualUseRemaining } from "./casual-use-logic";
import { createClientRequestId } from "../../shared/clientRequestId";

export function IngredientDetail({ item, busy, edit, use, waste }: { item: Ingredient; busy: boolean; edit: () => void; use: () => void; waste: () => void }) {
  return <div className="ingredient-detail">
    <dl className="detail-grid">
      <div><dt>分类</dt><dd>{item.category}</dd></div>
      <div><dt>当前库存</dt><dd>{stockLabel(item)}</dd></div>
      <div><dt>存放位置</dt><dd>{item.location || <>未填写 <button type="button" className="text-button" onClick={edit} disabled={busy}>补充位置</button></>}</dd></div>
    </dl>
    {item.note && <div className="detail-note"><h4>备注</h4><p>{item.note}</p></div>}
    <div className="actions ingredient-detail-actions"><button className="btn-primary" onClick={use} disabled={busy}>用掉了</button><button className="btn-ghost" onClick={edit} disabled={busy}>编辑</button><button className="text-button danger" onClick={waste} disabled={busy}>处理变质/损坏</button></div>
  </div>;
}

const adjustmentReasonText = { used: "日常用掉", spoiled: "变质", damaged: "损坏", other: "其他" } as const;
const wasteReasonText = { spoiled: adjustmentReasonText.spoiled, damaged: adjustmentReasonText.damaged, other: adjustmentReasonText.other } as const;

export function CasualUseEditor({ item, busy, blocked, save }: { item: Ingredient; busy: boolean; blocked: boolean; save: (payload: Parameters<typeof api.useIngredient>[1]) => void }) {
  const [quantity, setQuantity] = useState("");
  const [requestId] = useState(createClientRequestId);
  const amount = Number(quantity);
  const quantityError = quantityInputError(quantity, { required: true, max: item.stock_value });
  const half = casualUseHalf(item.stock_value);
  const remaining = casualUseRemaining(item.stock_value, quantity);
  return <form onSubmit={(event) => { event.preventDefault(); if (!quantityError && !blocked) save({ stock_text: quantity, stock_value: amount, stock_unit: item.stock_unit, client_request_id: requestId, expected_updated_at: item.updated_at }); }}>
    <p className="dialog-description">当前库存 {stockLabel(item)}。记录平时吃掉或用掉的数量，不关联餐安排。</p>
    <QuantityInput label={`这次用掉（${item.stock_unit}）`} required disabled={busy || blocked} max={item.stock_value} value={quantity} onValueChange={setQuantity} autoFocus />
    <div className="unit-choice">
      <button type="button" className="chip" disabled={busy || blocked || half === null} onClick={() => half && setQuantity(half)}>用掉一半</button>
      <button type="button" className="chip" disabled={busy || blocked} onClick={() => setQuantity(casualUseAll(item.stock_value))}>全部用完</button>
    </div>
    {remaining !== null && <p className="form-hint">记录后预计剩余 {remaining}{item.stock_unit}</p>}
    <p className="form-hint">已经在餐安排中确认的用量，不需要再次记录。</p>
    <button className="btn-primary submit" disabled={busy || blocked || Boolean(quantityError)}>{busy ? "保存中…" : "确认用掉"}</button>
  </form>;
}

export function WasteEditor({ item, busy, save }: { item: Ingredient; busy: boolean; save: (payload: Parameters<typeof api.wasteIngredient>[1]) => void }) {
  const [all, setAll] = useState(true);
  const [quantity, setQuantity] = useState(String(item.stock_value));
  const [reason, setReason] = useState<"spoiled" | "damaged" | "other">("spoiled");
  const amount = Number(quantity);
  const quantityError = quantityInputError(quantity, { required: true, max: item.stock_value });
  const invalid = Boolean(quantityError);
  return <form onSubmit={(event) => { event.preventDefault(); if (!invalid) save({ stock_text: quantity, stock_value: amount, stock_unit: item.stock_unit, reason, note: String(new FormData(event.currentTarget).get("note") || "") || null, expected_updated_at: item.updated_at }); }}>
    <p className="dialog-description">当前库存 {stockLabel(item)}。处理后可在“消耗与处理记录”的“变质 / 损坏”分类里查看。</p>
    <div className="unit-choice"><button type="button" className={all ? "chip active" : "chip"} onClick={() => { setAll(true); setQuantity(String(item.stock_value)); }}>全部处理</button><button type="button" className={!all ? "chip active" : "chip"} onClick={() => setAll(false)}>处理部分</button></div>
    <QuantityInput label={`处理数量（${item.stock_unit}）`} required disabled={all || busy} max={item.stock_value} value={quantity} onValueChange={setQuantity} />
    {!all && <p className="form-hint">数量每次增减 1，也可直接输入小数。</p>}
    <Field label="原因"><select value={reason} onChange={event => setReason(event.target.value as typeof reason)}>{Object.entries(wasteReasonText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
    <Field label="备注（选填）"><textarea name="note" rows={2} maxLength={5000} placeholder="例如：冷藏失温" /></Field>
    {invalid && <p className="form-error">{quantityError}</p>}
    <button className="btn-primary submit" disabled={busy || invalid}>{busy ? "处理中…" : "确认处理"}</button>
  </form>;
}

const adjustmentKindCopy = {
  used: {
    label: "日常用掉",
    hint: "平时吃掉或用掉",
    kicker: "日常消耗",
    title: "平时吃掉、用掉的记录",
    description: "不属于餐安排的日常消耗都留在这里，需要时可以安全撤销。",
    emptyTitle: "还没有日常用掉记录",
    emptyBody: "从食材详情点击“用掉了”，记录会单独留在这里。",
    activeEmpty: "目前没有可撤销的日常用掉记录。",
  },
  waste: {
    label: "变质 / 损坏",
    hint: "报废和其他处理",
    kicker: "库存处理",
    title: "变质与损坏记录",
    description: "变质、损坏和其他报废处理单独留档，不和日常用掉混在一起。",
    emptyTitle: "还没有变质或损坏记录",
    emptyBody: "需要处理食材时，记录会单独留在这里。",
    activeEmpty: "目前没有可撤销的变质或损坏记录。",
  },
} as const;

function useInventoryAdjustmentState(kind: InventoryAdjustmentKind, refreshKey: number) {
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${refreshKey}:${retryKey}`;
  const [result, setResult] = useState<{ key: string; state: InventoryAdjustmentLedgerState }>({
    key: "",
    state: { status: "loading" },
  });
  useEffect(() => {
    let alive = true;
    void readInventoryAdjustmentLedger(() => api.inventoryAdjustments(kind))
      .then((state) => { if (alive) setResult({ key: requestKey, state }); });
    return () => { alive = false; };
  }, [kind, requestKey]);
  return {
    state: result.key === requestKey ? result.state : { status: "loading" } as InventoryAdjustmentLedgerState,
    retry: () => setRetryKey((value) => value + 1),
  };
}

export function InventoryAdjustmentLedger({ busy, refreshKey, kind, setKind, revoke }: {
  busy: boolean;
  refreshKey: number;
  kind: InventoryAdjustmentKind;
  setKind: (kind: InventoryAdjustmentKind) => void;
  revoke: (id: number) => void;
}) {
  const used = useInventoryAdjustmentState("used", refreshKey);
  const waste = useInventoryAdjustmentState("waste", refreshKey);
  const states = { used: used.state, waste: waste.state };
  const state = states[kind];
  const copy = adjustmentKindCopy[kind];
  const total = (target: InventoryAdjustmentKind) => states[target].status === "ready" ? states[target].records.length : null;
  const countLabel = (target: InventoryAdjustmentKind) => states[target].status === "error"
    ? "读取失败"
    : states[target].status === "ready" ? `共${states[target].records.length}条` : "正在读取数量";
  const kindTabs = <div className="pn-adjustment-kind-tabs" role="group" aria-label="记录类型">
    {(["used", "waste"] as const).map((value) => <button type="button" key={value} className={kind === value ? "active" : ""} aria-label={`${adjustmentKindCopy[value].label}记录，${countLabel(value)}`} aria-pressed={kind === value} onClick={() => setKind(value)}>
      <span><strong>{adjustmentKindCopy[value].label}</strong><small>{adjustmentKindCopy[value].hint}</small></span>
      <b aria-hidden="true">{total(value) ?? "—"}</b>
    </button>)}
  </div>;
  if (state.status === "error") return <div className="pn-adjustment-ledger">{kindTabs}<section className="pn-adjustment-ledger-state pn-adjustment-ledger-state--error" role="alert">
    <span className="pn-adjustment-ledger-state-mark" aria-hidden="true">!</span>
    <div><p className="pn-adjustment-ledger-kicker">记录簿暂时合上了</p><h2>没能打开这类记录</h2><p>{state.message}</p></div>
    <button type="button" className="btn-primary" onClick={kind === "used" ? used.retry : waste.retry}>重新读取</button>
  </section></div>;
  if (state.status === "loading") return <div className="pn-adjustment-ledger">{kindTabs}<div className="pn-adjustment-ledger-state pn-adjustment-ledger-state--loading" role="status">
    <span className="pn-adjustment-ledger-pulse" aria-hidden="true" />
    <div><p className="pn-adjustment-ledger-kicker">正在翻找</p><p>正在读取{copy.label}记录…</p></div>
  </div></div>;
  const records = state.records;
  const active = records.filter((record) => record.status === "active");
  const reversed = records.filter((record) => record.status === "reversed");
  const overview = <header className="pn-adjustment-ledger-overview">
    <div><p className="pn-adjustment-ledger-kicker">{copy.kicker}</p><h2>{copy.title}</h2><p>{copy.description}</p></div>
    <dl>
      <div><dt>仍可撤销</dt><dd>{active.length}</dd></div>
      <div><dt>已撤销</dt><dd>{reversed.length}</dd></div>
    </dl>
  </header>;
  if (!records.length) return <div className="pn-adjustment-ledger">{kindTabs}{overview}<section className="pn-adjustment-ledger-empty">
    <div className="pn-adjustment-ledger-empty-date" aria-hidden="true"><span>—</span><strong>空</strong></div>
    <Empty title={copy.emptyTitle}>{copy.emptyBody}</Empty>
  </section></div>;
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
            <span className="pn-adjustment-record-reason">{adjustmentReasonText[record.reason]}</span>
            <h4 id={titleId}>{record.ingredient_name}</h4>
          </div>
          <span className={`pn-adjustment-record-status pn-adjustment-record-status--${record.status}`}>{record.status === "active" ? "可撤销" : "已撤销"}</span>
        </header>
        <div className="pn-adjustment-record-quantity" aria-label={`${record.reason === "used" ? "本次用掉" : "本次处理"}数量${inventoryAdjustmentAmountLabel(record)}`}>
          <span>{record.reason === "used" ? "本次用掉" : "本次处理"}</span>
          <strong>{inventoryAdjustmentAmountLabel(record)}</strong>
        </div>
        {record.note && <p className="pn-adjustment-record-note"><span>备注</span>{record.note}</p>}
        {record.status === "active" ? <div className="pn-adjustment-record-action">
          <span>{record.reason === "used" ? "这条用掉记录可安全撤回" : "处理仍可安全撤回"}</span>
          <button className="btn-primary" disabled={busy} onClick={() => revoke(record.id)} aria-label={`撤销${record.ingredient_name}的${adjustmentReasonText[record.reason]}记录`}>{record.reason === "used" ? "撤销用掉" : "撤销处理"}</button>
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
    {kindTabs}
    {overview}
    <div className={`pn-adjustment-ledger-lanes${reversed.length ? "" : " pn-adjustment-ledger-lanes--single"}`}>
      <section className="pn-adjustment-ledger-lane pn-adjustment-ledger-lane--active" aria-labelledby="active-adjustments-heading">
        <header><div><p>NOW / 现在</p><h2 id="active-adjustments-heading">仍可撤销</h2></div><span>{active.length} 条</span></header>
        {active.length ? renderGroups(active, "active") : <p className="pn-adjustment-ledger-lane-empty">{copy.activeEmpty}</p>}
      </section>
      {reversed.length > 0 && <section className="pn-adjustment-ledger-lane pn-adjustment-ledger-lane--history" aria-labelledby="reversed-adjustments-heading">
        <header><div><p>ARCHIVE / 归档</p><h2 id="reversed-adjustments-heading">已经撤销</h2></div><span>{reversed.length} 条</span></header>
        {renderGroups(reversed, "history")}
      </section>}
    </div>
  </div>;
}
