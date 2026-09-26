import type { OcrReceiptIgnored, OcrReceiptItem } from "../../shared/api/client";
import { classifyIngredientName, normalizeIngredientName, type IngredientCategory } from "./ingredient-classify";
import { suggestLocation, type IngredientLocation, type LocationSource } from "./ingredient-location";

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
  /** 用户在草稿里手动选过分类后，改名不再自动重算分类。 */
  categoryTouched: boolean;
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
  /** 拍照重复被自动合并的汇总；界面上折叠展示供核查。 */
  removed: PhotoDuplicateSummary[];
};

export type PhotoDuplicateSummary = { name: string; quantity: string; unit: string; count: number };

/**
 * 拍照重复自动合并：同一张小票被拍进两张照片时，商品行的名称、数量、
 * 金额完全一致——直接保留最早一条，其余删除，不再让用户逐个核对删除。
 * 缺数量的行（等待缝合或待补填）不参与，避免误删缝合对象；
 * 名称或数量不同的同名行仍走疑似重复标记，由用户定夺。
 */
export function collapsePhotoDuplicates(rows: OcrDraftRow[]): { rows: OcrDraftRow[]; removed: PhotoDuplicateSummary[] } {
  const seen = new Set<string>();
  const kept: OcrDraftRow[] = [];
  const removed = new Map<string, PhotoDuplicateSummary>();
  for (const row of rows) {
    const key = normalizeIngredientName(row.name).toLowerCase();
    const signature = key && row.quantity ? `${key}|${row.quantity}|${row.priceText ?? ""}` : null;
    if (signature && seen.has(signature)) {
      const summary = removed.get(signature) ?? { name: row.name, quantity: row.quantity, unit: row.unit, count: 0 };
      summary.count += 1;
      removed.set(signature, summary);
      continue;
    }
    if (signature) seen.add(signature);
    kept.push(row);
  }
  return { rows: kept, removed: [...removed.values()] };
}

export type OcrDraftGroup = { key: string; rows: OcrDraftRow[] };

/** 展示顺序：同名行聚合相邻（组间按首次出现顺序），方便对照取舍。 */
export function groupDraftRows(rows: OcrDraftRow[]): OcrDraftGroup[] {
  const groups = new Map<string, OcrDraftGroup>();
  const order: string[] = [];
  for (const row of rows) {
    const key = normalizeIngredientName(row.name).toLowerCase() || `#${row.id}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else {
      groups.set(key, { key, rows: [row] });
      order.push(key);
    }
  }
  return order.map((key) => groups.get(key) as OcrDraftGroup);
}

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
      categoryTouched: false,
      uncertain: (item.score ?? 1) < UNCERTAIN_SCORE,
      duplicate: false,
      openEnded: Boolean(item.open_ended),
    };
  });
}

/**
 * 全量重推行间的疑似重复关系：duplicate 是行与行之间的关系，
 * 不是行的固有属性——删除、改名、追加任何变动后都要重算一遍，
 * 否则会残留指向已删行的幽灵标记。
 * 同名组内有"疑似同一条"的同伴（金额相等或任一缺金额）才标记。
 */
export function markDuplicates(rows: OcrDraftRow[]): OcrDraftRow[] {
  const byName = new Map<string, OcrDraftRow[]>();
  for (const row of rows) {
    const key = normalizeIngredientName(row.name).toLowerCase();
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  return rows.map((row) => {
    const key = normalizeIngredientName(row.name).toLowerCase();
    const candidates = key ? byName.get(key) ?? [] : [];
    const duplicate = candidates.some((other) => other.id !== row.id
      && (!row.priceText || !other.priceText || row.priceText === other.priceText));
    return duplicate === row.duplicate ? row : { ...row, duplicate };
  });
}

/**
 * 草稿行编辑的统一入口：改名后重推重复关系，名称是用户没手动改过
 * 分类时还自动重算分类；手动补数量后行不再等待跨张缝合。
 */
export function editOcrRow(
  rows: OcrDraftRow[],
  id: number,
  patch: Partial<Pick<OcrDraftRow, "name" | "quantity" | "unit" | "category" | "priceText">>,
  known: { name: string; category: string }[],
): OcrDraftRow[] {
  const next = rows.map((row) => {
    if (row.id !== id) return row;
    const merged: OcrDraftRow = { ...row, ...patch };
    if (patch.name !== undefined && patch.name !== row.name && !row.categoryTouched) {
      merged.category = classifyIngredientName(merged.name, known);
    }
    if (patch.category !== undefined) {
      merged.categoryTouched = true;
    }
    if (patch.quantity !== undefined && merged.quantity !== "") {
      merged.needsQuantity = false;
      merged.openEnded = false;
    }
    return merged;
  });
  return markDuplicates(next);
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
  // 截断按原始商品行数判断：合并只减少行数，不能把"超过上限"这件事也吞掉。
  const usableCount = items.filter((item) => item.name.trim() !== "").length;
  const collapsed = collapsePhotoDuplicates(toDraftRows(items, known, 1));
  return {
    rows: collapsed.rows,
    ignored,
    truncated: usableCount > MAX_OCR_ROWS,
    removed: collapsed.removed,
  };
}

export type AppendResult = {
  rows: OcrDraftRow[];
  ignored: OcrIgnoredEntry[];
  truncated: boolean;
  /** 本次缝合成功的商品名称；用于界面轻提示。 */
  mergedName: string | null;
  /** 本次自动合并的拍照重复；用于界面折叠展示。 */
  removedDuplicates: PhotoDuplicateSummary[];
};

/**
 * 把新识别的一张小票累加进已有草稿：
 * - 行 id 续号，新行照常自动分类；
 * - 新图开头若为孤儿数量金额、且上一张末尾有悬空名称行，自动缝合；
 * - 两张照片里名称数量金额完全一致的行自动合并（拍照重复）；
 * - 剩余的同名行标记疑似重复，由用户核对删除；
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

  let nextRowId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  for (const row of incoming.rows) {
    rows.push({ ...row, id: nextRowId++ });
  }
  // 拍照重复自动合并：跨照片完全一致的行直接去掉，免去逐个核对。
  const collapsed = collapsePhotoDuplicates(rows);
  let merged = collapsed.rows;
  let truncated = incoming.truncated;
  if (merged.length > MAX_OCR_ROWS) {
    merged = merged.slice(0, MAX_OCR_ROWS);
    truncated = true;
  }
  return { rows: markDuplicates(merged), ignored, truncated, mergedName, removedDuplicates: collapsed.removed };
}

/** 核对待办计数：分层核对引导条的数据源。 */
/**
 * 第一轮核对清单：这一轮只确认识别结果，疑似重复和待分类都清零才能
 * 进入第二轮——第二轮不再有分类控件，待分类的行进入后会没有归属。
 * 数量属于第二轮，不在这里计入待办。
 */
export function reviewChecklist(rows: OcrDraftRow[]): {
  total: number;
  duplicates: number;
  pendingCategory: number;
  readyToContinue: boolean;
} {
  const duplicates = rows.filter((row) => row.duplicate).length;
  const pendingCategory = rows.filter((row) => !row.category).length;
  return {
    total: rows.length,
    duplicates,
    pendingCategory,
    readyToContinue: rows.length > 0 && duplicates === 0 && pendingCategory === 0,
  };
}

/** 进入第二轮时带过去的一行：分类已在第一轮定好，位置按习惯预填。 */
export type OcrPrefillRow = {
  name: string;
  quantity: string;
  unit: string;
  category: IngredientCategory;
  location: IngredientLocation | "";
  /** 预填位置的来源；空串表示没有依据、未预填。 */
  locationSource: LocationSource | "";
};

/**
 * 第一轮确认后生成第二轮的预填行：按最终名称和分类推断存放位置
 * （第一轮改过的名称和分类都会影响推断结果）。调用前须 readyToContinue。
 */
export function toPrefillRows(
  rows: OcrDraftRow[],
  habits: { name: string; category: string; location?: string | null }[],
): OcrPrefillRow[] {
  return rows.filter((row) => row.category).map((row) => {
    const suggestion = suggestLocation(row.name, row.category, habits);
    return {
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: row.category as IngredientCategory,
      location: suggestion?.location ?? "",
      locationSource: suggestion?.source ?? "",
    };
  });
}
