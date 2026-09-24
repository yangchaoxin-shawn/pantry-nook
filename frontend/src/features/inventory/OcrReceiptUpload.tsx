import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, CATEGORIES, type Ingredient } from "../../shared/api/client";
import { Icon } from "../../shared/ui/Primitives";
import { ocrItemsToDraftRows, type OcrDraftRow } from "./ocr-receipt-logic";

/**
 * 拍小票入库的第一步：选图或拖入小票照片，识别后给出可勾选的商品草稿。
 * 这里做“识别 → 改分类 → 删掉不想要的行”；数量、单位补齐和保存走既有批量录入。
 * 分类对照来自食材全量历史：用户修正过的分类持久覆盖内置词表。
 */
export function OcrReceiptUpload({
  knownIngredients,
  onRecognized,
}: {
  knownIngredients: Ingredient[];
  onRecognized: (rows: OcrDraftRow[]) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recognizing">("idle");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState<{ rows: OcrDraftRow[]; ignored: { text: string; reason: string }[]; truncated: boolean } | null>(null);
  const [library, setLibrary] = useState<{ name: string; category: string }[]>(
    () => knownIngredients.map((item) => ({ name: item.name, category: item.category })),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    // 对照库含已消耗/已报废的历史食材，读不到时退回当前在库列表。
    api.categoryLibrary()
      .then((result) => { if (!cancelled && result.data.length) setLibrary(result.data); })
      .catch(() => { /* 读取失败沿用初始匹配源 */ });
    return () => { cancelled = true; };
  }, []);

  async function recognize(file: File | null | undefined) {
    if (!file || phase === "recognizing") return;
    if (!file.type.startsWith("image/")) {
      setError("请选择小票照片（图片文件）。");
      return;
    }
    setError("");
    setPhase("recognizing");
    try {
      const result = await api.analyzeReceipt(file);
      const next = ocrItemsToDraftRows(result.data.items, library);
      if (!next.rows.length) {
        setError("这张小票没有识别出商品。请尽量拍清商品名称区域，或改用手动录入。");
        setDraft(null);
      } else {
        setDraft({ ...next, ignored: result.data.ignored });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "识别失败，请重试。");
      setDraft(null);
    } finally {
      setPhase("idle");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void recognize(event.dataTransfer.files?.[0]);
  }

  if (!draft) {
    return (
      <div className="ocr-receipt-upload">
        <div
          className={dragOver ? "ocr-dropzone dragover" : "ocr-dropzone"}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <Icon name="camera" size={26} />
          <p>把小票照片拖到这里，或</p>
          <button type="button" className="btn-primary" disabled={phase === "recognizing"} onClick={() => inputRef.current?.click()}>
            拍照 / 选择图片
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="选择小票照片"
            hidden
            onChange={(event) => {
              void recognize(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <p className="form-hint">识别结果只是草稿，保存前会请你逐项核对。</p>
        </div>
        {phase === "recognizing" && <p className="form-hint" role="status">正在识别小票…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    );
  }

  const remaining = draft.rows.filter((row) => row.name.trim() !== "");
  const autoCount = draft.rows.filter((row) => row.category).length;
  return (
    <div className="ocr-receipt-review">
      <p className="form-notice">以下商品来自这张小票，都是草稿。分类按你家已有食材自动带出，可直接修改；删掉不需要的行后继续。</p>
      {draft.truncated && <p className="form-notice">小票商品超过 30 项，已保留前 30 项，其余请稍后手动补录。</p>}
      <ul className="ocr-draft-rows">
        {draft.rows.map((row, index) => (
          <li className="ocr-draft-row" key={row.id}>
            <span className="batch-row-number" aria-hidden="true">{index + 1}</span>
            <span className="ocr-draft-name">
              {row.name}
              {row.needsQuantity && <small>待补数量</small>}
              {row.uncertain && <small className="ocr-uncertain">识别不确定</small>}
            </span>
            <select
              className="ocr-draft-category"
              aria-label={`第 ${index + 1} 项 ${row.name} 的分类`}
              value={row.category ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => current && {
                  ...current,
                  rows: current.rows.map((entry) => entry.id === row.id
                    ? { ...entry, category: (value || null) as OcrDraftRow["category"] }
                    : entry),
                });
              }}
            >
              <option value="">待分类</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <span className="ocr-draft-meta">{row.quantity ? `${row.quantity}${row.unit}` : ""}{row.priceText && ` · ¥${row.priceText}`}</span>
            <button
              type="button"
              className="text-button batch-row-remove"
              aria-label={`删除第 ${index + 1} 项 ${row.name}`}
              onClick={() => setDraft((current) => current && { ...current, rows: current.rows.filter((entry) => entry.id !== row.id) })}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
      {draft.ignored.length > 0 && <details className="ocr-ignored">
        <summary>已跳过 {draft.ignored.length} 行（表头、合计或无法识别的行）</summary>
        <ul>{draft.ignored.map((entry, index) => <li key={index}>{entry.text}</li>)}</ul>
      </details>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="btn-ghost" disabled={phase === "recognizing"} onClick={() => { setDraft(null); setError(""); inputRef.current?.click(); }}>
          重拍一张
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!remaining.length || phase === "recognizing"}
          onClick={() => onRecognized(draft.rows)}
        >
          继续核对并保存
        </button>
      </div>
      <p className="form-hint">{autoCount === draft.rows.length
        ? "这一票的商品都自动分好类了，保存后同类食材以后会继续自动归类。"
        : `已自动分类 ${autoCount}/${draft.rows.length} 项；改过的分类会随食材入库，下次自动带出。`}</p>
    </div>
  );
}
