import type { OcrReceiptIgnored, OcrReceiptItem } from "../../shared/api/client";
import { classifyIngredientName, normalizeIngredientName, type IngredientCategory } from "./ingredient-classify";

export type OcrDraftRow = {
  id: number;
  name: string;
  quantity: string;
  unit: string;
  /** 小票上的金额，仅作与纸质小票核对的参考，不会保存。 */
  priceText: string | null;
  /** 识别数量缺失或为 0 时需要用户补填。 */
  needsQuantity: boolean;
  /** 自动分类结果；null 表示待分类，由用户手选。 */
  category: IngredientCategory | null;
  /** OCR 置信度偏低，重点核对。 */
  uncertain: boolean;
  /** 与已有行同名同金额，疑似分段拍摄的重叠商品，由用户核对删除。 */
  duplicate: boolean;
  /** 名称行的数量可能拍在下一张分段图的开头，等待缝合。 */
  openEnded: boolean;
};

export type OcrIgnoredEntry = OcrReceiptIgnored & { text: string };

export type OcrRecognition = {
  rows: OcrDraftRow[];
  ignored: OcrIgnoredEntry[];
  truncated: boolean;
};

/** 批量入库接口一次最多 30 项，超出部分提示用户分两次。 */
export const MAX_OCR_ROWS = 30;
/** 低于该置信度的行在草稿里标记“识别不确定”。 */
export const UNCERTAIN_SCORE = 0.85;

/**
 * OCR 数量只接受正的十进制数字；其余（缺失、0、异常）一律视为待补填，
 * 由用户在核对或批量录入时手工补齐。
 */
export function normalizeOcrQuantity(text: string | null | undefined): string {
  const trimmed = (text ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return "";
  const value = Number(trimmed);
  return value > 0 ? String(value) : "";
}

function toDraftRows(
  items: OcrReceiptItem[],
  known: { name: string; category: string }[],
  firstId: number,
): OcrDraftRow[] {
  const usable = items.filter((item) => item.name.trim() !== "");
  return usable.slice(0, Math.max(0, MAX_OCR_ROWS - firstId + 1)).map((item, index) => {
    const quantity = normalizeOcrQuantity(item.quantity_text);
    return {
      id: firstId + index,
      name: item.name.trim(),
      quantity,
      unit: item.unit?.trim() ?? "",
      priceText: item.price_text?.trim() || null,
      needsQuantity: quantity === "",
      category: classifyIngredientName(item.name, known),
      uncertain: (item.score ?? 1) < UNCERTAIN_SCORE,
      duplicate: false,
      openEnded: Boolean(item.open_ended),
    };
  });
}

/**
 * 把一次识别结果转换为可累加的草稿片段：行、跳过行、截断标记。
 * 孤儿数量金额行（名称在上一张分段图里）保留在跳过行中，
 * 由 appendOcrDraft 尝试与上一张末尾的悬空名称行缝合，缝合成才移除。
 * known 为分类对照库（食材全量历史），用于自动分类。
 */
export function recognizeToDraft(
  items: OcrReceiptItem[],
  ignored: OcrIgnoredEntry[],
  known: { name: string; category: string }[],
): OcrRecognition {
  return {
    rows: toDraftRows(items, known, 1),
    ignored,
    truncated: items.filter((item) => item.name.trim() !== "").length > MAX_OCR_ROWS,
  };
}

export type AppendResult = {
  rows: OcrDraftRow[];
  ignored: OcrIgnoredEntry[];
  truncated: boolean;
  /** 本次缝合成功的商品名称；用于界面轻提示。 */
  mergedName: string | null;
};

/**
 * 把新识别的一张小票累加进已有草稿：
 * - 行 id 续号，新行照常自动分类；
 * - 新图开头若为孤儿数量金额、且上一张末尾有悬空名称行，自动缝合；
 * - 新行与已有行归一化名称和金额都相同时标记疑似重复，由用户核对删除；
 * - 超过批量上限 30 项的行丢弃并置 truncated，提示分两次保存。
 */
export function appendOcrDraft(
  existing: OcrDraftRow[],
  existingIgnored: OcrIgnoredEntry[],
  incoming: OcrRecognition,
): AppendResult {
  const rows = [...existing];
  const ignored = [...existingIgnored, ...incoming.ignored];
  let mergedName: string | null = null;

  // 跨张缝合：新图开头有孤儿数量、上一张末尾是悬空名称行。
  if (rows.length) {
    const last = rows[rows.length - 1];
    if (last.openEnded && last.needsQuantity) {
      const orphan = incoming.ignored.find((entry) => entry.quantity_text);
      if (orphan) {
        const quantity = normalizeOcrQuantity(orphan.quantity_text);
        if (quantity) {
          rows[rows.length - 1] = {
            ...last,
            quantity,
            priceText: orphan.amount_text?.trim() || last.priceText,
            needsQuantity: false,
            openEnded: false,
          };
          mergedName = last.name;
          const orphanIndex = ignored.indexOf(orphan);
          if (orphanIndex >= 0) ignored.splice(orphanIndex, 1);
        }
      }
    }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const nameOf = (row: OcrDraftRow) => normalizeIngredientName(row.name).toLowerCase();
  const existingByName = new Map<string, OcrDraftRow[]>();
  for (const row of rows) {
    const key = nameOf(row);
    existingByName.set(key, [...(existingByName.get(key) ?? []), row]);
  }
  const isDuplicate = (row: OcrDraftRow) => {
    const candidates = existingByName.get(nameOf(row));
    if (!candidates?.length) return false;
    // 金额相同或任一行缺金额都算疑似重复；同一行打印两次金额必然一致。
    return candidates.some((other) => !row.priceText || !other.priceText || row.priceText === other.priceText);
  };
  let nextRowId = nextId;
  let remaining = MAX_OCR_ROWS - rows.length;
  for (const row of incoming.rows) {
    if (remaining <= 0) {
      return { rows, ignored, truncated: true, mergedName };
    }
    const duplicate = isDuplicate(row);
    const entry: OcrDraftRow = { ...row, id: nextRowId++, duplicate };
    existingByName.set(nameOf(entry), [...(existingByName.get(nameOf(entry)) ?? []), entry]);
    rows.push(entry);
    remaining -= 1;
  }
  return { rows, ignored, truncated: incoming.truncated, mergedName };
}

/** 核对待办计数：分层核对引导条的数据源。 */
export function reviewChecklist(rows: OcrDraftRow[]): {
  total: number;
  duplicates: number;
  pendingCategory: number;
  pendingQuantity: number;
  allClear: boolean;
} {
  const duplicates = rows.filter((row) => row.duplicate).length;
  const pendingCategory = rows.filter((row) => !row.category).length;
  const pendingQuantity = rows.filter((row) => row.needsQuantity).length;
  return {
    total: rows.length,
    duplicates,
    pendingCategory,
    pendingQuantity,
    allClear: duplicates === 0 && pendingCategory === 0 && pendingQuantity === 0,
  };
}
