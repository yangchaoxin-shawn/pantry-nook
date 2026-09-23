import { describe, expect, it } from "vitest";
import { MAX_OCR_ROWS, normalizeOcrQuantity, ocrItemsToDraftRows, type OcrDraftRow } from "./ocr-receipt-logic";

describe("normalizeOcrQuantity", () => {
  it("保留正的十进制数量并去掉多余格式", () => {
    expect(normalizeOcrQuantity("2")).toBe("2");
    expect(normalizeOcrQuantity("0.852")).toBe("0.852");
    expect(normalizeOcrQuantity(" 2.50 ")).toBe("2.5");
    expect(normalizeOcrQuantity("007")).toBe("7");
  });

  it("缺失、零或非数字一律待补填", () => {
    expect(normalizeOcrQuantity(null)).toBe("");
    expect(normalizeOcrQuantity("0")).toBe("");
    expect(normalizeOcrQuantity("1/2")).toBe("");
    expect(normalizeOcrQuantity("两斤")).toBe("");
  });
});

describe("ocrItemsToDraftRows", () => {
  const item = (overrides: Partial<{ name: string; quantity_text: string | null; unit: string | null; price_text: string | null }>) => ({
    name: "土豆", quantity_text: null, unit: null, price_text: null, raw_text: "土豆", score: 0.9,
    ...overrides,
  });

  it("映射识别结果并标记缺数量的行", () => {
    const { rows, truncated } = ocrItemsToDraftRows([
      item({ name: " 土豆 ", quantity_text: "2", unit: "斤", price_text: "3.60" }),
      item({ name: "散装糖果" }),
    ]);
    expect(truncated).toBe(false);
    expect(rows).toEqual<OcrDraftRow[]>([
      { id: 1, name: "土豆", quantity: "2", unit: "斤", priceText: "3.60", needsQuantity: false },
      { id: 2, name: "散装糖果", quantity: "", unit: "", priceText: null, needsQuantity: true },
    ]);
  });

  it("丢弃空名称并按上限截断", () => {
    const many = Array.from({ length: MAX_OCR_ROWS + 3 }, (_, index) => item({ name: `商品${index + 1}`, quantity_text: "1" }));
    const { rows, truncated } = ocrItemsToDraftRows([item({ name: "   " }), ...many]);
    expect(rows).toHaveLength(MAX_OCR_ROWS);
    expect(truncated).toBe(true);
  });
});
