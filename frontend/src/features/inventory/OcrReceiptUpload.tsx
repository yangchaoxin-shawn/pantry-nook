import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, CATEGORIES, type Ingredient } from "../../shared/api/client";
import { Icon } from "../../shared/ui/Primitives";
import {
  appendOcrDraft,
  MAX_OCR_ROWS,
  recognizeToDraft,
  reviewChecklist,
  type OcrDraftRow,
  type OcrIgnoredEntry,
} from "./ocr-receipt-logic";

type ChecklistFilter = "all" | "duplicate" | "category" | "quantity";

/**
 * 拍小票入库：小票可分段多拍、累加成一个草稿；跨张切分由系统自动缝合，
 * 重叠商品标记疑似重复。核对按"删错的 → 确认分类 → 补数值"分层引导，
 * 全部处理完（或用户自行判断后）进入批量录入完成保存。
 */
export function OcrReceiptUpload({
  knownIngredients,
  onRecognized,
}: {
  knownIngredients: Ingredient[];
  onRecognized: (rows: OcrDraftRow[]) => void;
}) {
  const [phase, setPhase] = useState<{ busy: boolean; current: number; total: number }>({ busy: false, current: 0, total: 0 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<OcrDraftRow[]>([]);
  const [ignored, setIgnored] = useState<OcrIgnoredEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
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

  /**
   * 多张小票一次选择后逐张识别累加：CPU 识别一张需要十几到几十秒，
   * 顺序进行避免争抢；单张失败不中断整批，最后汇总提示。
   * 累计到批量上限 30 项后停止识别剩余图片。
   */
  async function recognizeFiles(fileList: FileList | File[] | null | undefined) {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length || phase.busy) {
      if (files.length !== (fileList ? Array.from(fileList).length : 0)) {
        setError("只支持图片文件，其他文件已忽略。");
      }
      return;
    }
    setError("");
    setNotice("");
    setPhase({ busy: true, current: 1, total: files.length });
    let currentRows = rows;
    let currentIgnored = ignored;
    let currentTruncated = truncated;
    const failed: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        setPhase({ busy: true, current: index + 1, total: files.length });
        const remaining = MAX_OCR_ROWS - currentRows.length;
        if (remaining <= 0) {
          const rest = files.length - index;
          setNotice(`已累计 ${MAX_OCR_ROWS} 项到上限，本次先保存这些，剩余 ${rest} 张未识别。`);
          break;
        }
        try {
          const result = await api.analyzeReceipt(files[index]);
          const recognition = recognizeToDraft(result.data.items, result.data.ignored, library);
          if (!currentRows.length) {
            if (!recognition.rows.length) {
              failed.push(`第 ${index + 1} 张没有识别出商品`);
              continue;
            }
            currentRows = recognition.rows;
            currentIgnored = recognition.ignored;
            currentTruncated = recognition.truncated;
          } else {
            const appended = appendOcrDraft(currentRows, currentIgnored, recognition);
            currentRows = appended.rows;
            currentIgnored = appended.ignored;
            currentTruncated = appended.truncated;
            if (appended.mergedName) {
              setNotice(`已把这张开头的数量金额并入上一张末尾的「${appended.mergedName}」。`);
            }
          }
          setRows(currentRows);
          setIgnored(currentIgnored);
          setTruncated(currentTruncated);
        } catch (cause) {
          failed.push(`第 ${index + 1} 张：${cause instanceof Error ? cause.message : "识别失败"}`);
        }
      }
      if (failed.length) setError(failed.join("；"));
    } finally {
      setPhase({ busy: false, current: 0, total: 0 });
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void recognizeFiles(event.dataTransfer.files);
  }

  function updateRow(id: number, patch: Partial<OcrDraftRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  const checklist = reviewChecklist(rows);
  const visible = rows.filter((row) => {
    if (filter === "duplicate") return row.duplicate;
    if (filter === "category") return !row.category;
    if (filter === "quantity") return row.needsQuantity;
    return true;
  });
  const pendingCount = checklist.duplicates + checklist.pendingCategory + checklist.pendingQuantity;

  const chips: { key: ChecklistFilter; label: string }[] = [
    { key: "all", label: `全部 ${checklist.total}` },
    { key: "duplicate", label: `疑似重复 ${checklist.duplicates}` },
    { key: "category", label: `待分类 ${checklist.pendingCategory}` },
    { key: "quantity", label: `待补数量 ${checklist.pendingQuantity}` },
  ];

  if (!rows.length) {
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
          <button type="button" className="btn-primary" disabled={phase.busy} onClick={() => inputRef.current?.click()}>
            拍照 / 选择图片
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            aria-label="选择小票照片"
            hidden
            onChange={(event) => {
              void recognizeFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <p className="form-hint">可一次多选已拍好的小票，长票分段拍也行，识别结果自动累加拼接。</p>
        </div>
        {phase.busy && <p className="form-hint" role="status">正在识别 {phase.current}/{phase.total} 张小票…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="ocr-receipt-review">
      <div className="ocr-checklist" role="group" aria-label="核对待办">
        {chips.map(({ key, label }) => {
          const muted = key !== "all" && label.endsWith(" 0");
          return <button
            type="button"
            key={key}
            className={filter === key ? "ocr-chip active" : muted ? "ocr-chip muted" : "ocr-chip"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >{label}</button>;
        })}
      </div>
      {notice && <p className="form-hint" role="status">{notice}</p>}
      {truncated && <p className="form-notice">累计商品已到 30 项上限，本次先保存这些，其余请稍后再拍一张单独入库。</p>}
      <ul className="ocr-draft-rows">
        {visible.map((row) => (
          <li className={row.duplicate ? "ocr-draft-row duplicate" : "ocr-draft-row"} key={row.id}>
            <span className="batch-row-number" aria-hidden="true">{rows.indexOf(row) + 1}</span>
            {editingId === row.id ? (
              <input
                className="ocr-draft-name-input"
                aria-label={`修改第 ${rows.indexOf(row) + 1} 项名称`}
                autoFocus
                defaultValue={row.name}
                maxLength={255}
                onBlur={(event) => { updateRow(row.id, { name: event.target.value.trim() || row.name }); setEditingId(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  if (event.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="ocr-draft-name text-button"
                title="点击修改名称"
                onClick={() => setEditingId(row.id)}
              >
                {row.name}
                {row.needsQuantity && <small>待补数量</small>}
                {row.uncertain && <small className="ocr-uncertain">识别不确定</small>}
                {row.duplicate && <small className="ocr-duplicate">疑似重复</small>}
              </button>
            )}
            <select
              className="ocr-draft-category"
              aria-label={`第 ${rows.indexOf(row) + 1} 项 ${row.name} 的分类`}
              value={row.category ?? ""}
              onChange={(event) => updateRow(row.id, { category: (event.target.value || null) as OcrDraftRow["category"] })}
            >
              <option value="">待分类</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <span className="ocr-draft-meta">{row.quantity ? `${row.quantity}${row.unit}` : ""}{row.priceText && ` · ¥${row.priceText}`}</span>
            <button
              type="button"
              className="text-button batch-row-remove"
              aria-label={`删除第 ${rows.indexOf(row) + 1} 项 ${row.name}`}
              onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
            >
              删除
            </button>
          </li>
        ))}
        {!visible.length && <li className="ocr-draft-empty">这一类没有待处理的行。</li>}
      </ul>
      {ignored.length > 0 && <details className="ocr-ignored">
        <summary>已跳过 {ignored.length} 行（表头、合计或无法识别的行）</summary>
        <ul>{ignored.map((entry, index) => <li key={index}>{entry.text}</li>)}</ul>
      </details>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="btn-ghost" disabled={phase.busy} onClick={() => inputRef.current?.click()}>
          再拍一张累加
        </button>
        <button type="button" className="btn-ghost" disabled={phase.busy} onClick={() => { setRows([]); setIgnored([]); setTruncated(false); setNotice(""); setError(""); setFilter("all"); }}>
          清空重拍
        </button>
        <button
          type="button"
          className={pendingCount ? "btn-ghost ocr-save-pending" : "btn-primary"}
          disabled={!rows.length || phase.busy || checklist.duplicates > 0}
          title={checklist.duplicates ? "同一批不能有同名食材，请先删除疑似重复的行" : undefined}
          onClick={() => onRecognized(rows)}
        >
          {phase.busy
            ? `正在识别 ${phase.current}/${phase.total} 张…`
            : checklist.duplicates
            ? `${checklist.duplicates} 项疑似重复，删除后再保存`
            : pendingCount
            ? `还有 ${pendingCount} 项待核对，继续保存`
            : "继续核对并保存"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="再拍一张小票"
        hidden
        onChange={(event) => {
          void recognizeFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <p className="form-hint">
        {checklist.allClear
          ? "待办都清零了。分类改动会随食材入库，下次自动带出。"
          : "建议顺序：先删疑似重复，再确认分类，最后补数量；也可以直接保存，后面还有一步总核对。"}
      </p>
    </div>
  );
}
