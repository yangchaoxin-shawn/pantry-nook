import type { OcrReceiptItem } from "../../shared/api/client";

export type OcrDraftRow = {
  id: number;
  name: string;
  quantity: string;
  unit: string;
  /** 小票上的金额，仅作与纸质小票核对的参考，不会保存。 */
  priceText: string | null;
  /** 识别数量缺失或为 0 时需要用户补填。 */
  needsQuantity: boolean;
};

/** 批量入库接口一次最多 30 项，超出部分提示用户分两次。 */
export const MAX_OCR_ROWS = 30;

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

export function ocrItemsToDraftRows(items: OcrReceiptItem[]): { rows: OcrDraftRow[]; truncated: boolean } {
  const usable = items.filter((item) => item.name.trim() !== "");
  return {
    rows: usable.slice(0, MAX_OCR_ROWS).map((item, index) => {
      const quantity = normalizeOcrQuantity(item.quantity_text);
      return {
        id: index + 1,
        name: item.name.trim(),
        quantity,
        unit: item.unit?.trim() ?? "",
        priceText: item.price_text?.trim() || null,
        needsQuantity: quantity === "",
      };
    }),
    truncated: usable.length > MAX_OCR_ROWS,
  };
}
