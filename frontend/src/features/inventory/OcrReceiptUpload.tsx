import { useRef, useState, type DragEvent } from "react";
import { api } from "../../shared/api/client";
import { Icon } from "../../shared/ui/Primitives";
import { ocrItemsToDraftRows, type OcrDraftRow } from "./ocr-receipt-logic";

/**
 * 拍小票入库的第一步：选图或拖入小票照片，识别后给出可勾选的商品草稿。
 * 这里只做“识别 → 删掉不想要的行”；补数量、选分类和保存仍走既有批量录入。
 */
export function OcrReceiptUpload({ onRecognized }: { onRecognized: (rows: OcrDraftRow[]) => void }) {
  const [phase, setPhase] = useState<"idle" | "recognizing">("idle");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState<{ rows: OcrDraftRow[]; truncated: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const next = ocrItemsToDraftRows(result.data.items);
      if (!next.rows.length) {
        setError("这张小票没有识别出商品。请尽量拍清商品名称区域，或改用手动录入。");
        setDraft(null);
      } else {
        setDraft(next);
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
  return (
    <div className="ocr-receipt-review">
      <p className="form-notice">以下商品来自这张小票，都是草稿。数量和小票金额仅供参考，删掉不需要的行后继续；分类、单位和数量会在下一步补齐。</p>
      {draft.truncated && <p className="form-notice">小票商品超过 30 项，已保留前 30 项，其余请稍后手动补录。</p>}
      <ul className="ocr-draft-rows">
        {draft.rows.map((row, index) => (
          <li className="ocr-draft-row" key={row.id}>
            <span className="batch-row-number" aria-hidden="true">{index + 1}</span>
            <span className="ocr-draft-name">{row.name}{row.needsQuantity && <small>待补数量</small>}{!row.unit && !row.needsQuantity && <small>待选单位</small>}</span>
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
    </div>
  );
}
