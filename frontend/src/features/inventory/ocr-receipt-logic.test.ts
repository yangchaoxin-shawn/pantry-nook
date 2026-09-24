import { describe, expect, it } from "vitest";
import {
  MAX_OCR_ROWS,
  appendOcrDraft,
  editOcrRow,
  markDuplicates,
  normalizeOcrQuantity,
  recognizeToDraft,
  reviewChecklist,
  type OcrDraftRow,
  type OcrIgnoredEntry,
} from "./ocr-receipt-logic";

const item = (overrides: Partial<{ name: string; quantity_text: string | null; unit: string | null; price_text: string | null; score: number; open_ended: boolean }> = {}) => ({
  name: "土豆", quantity_text: null, unit: null, price_text: null, raw_text: "土豆", score: 0.98,
  ...overrides,
});

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

describe("recognizeToDraft", () => {
  it("映射识别结果并标记缺数量与不确定的行", () => {
    const { rows, truncated } = recognizeToDraft(
      [
        item({ name: " 土豆 ", quantity_text: "2", unit: "斤", price_text: "3.60" }),
        item({ name: "糊图商品", score: 0.66 }),
      ],
      [{ text: "合计", reason: "noise" }],
      [],
    );
    expect(truncated).toBe(false);
    expect(rows[0]).toMatchObject({ name: "土豆", quantity: "2", unit: "斤", priceText: "3.60", needsQuantity: false, category: "蔬菜", uncertain: false });
    expect(rows[1]).toMatchObject({ name: "糊图商品", uncertain: true });
  });

  it("孤儿数量金额保留在跳过行，等待累加时缝合", () => {
    const orphan: OcrIgnoredEntry = { text: "0.8525.965.08", reason: "numeric-only", quantity_text: "0.852", amount_text: "5.08" };
    const { rows, ignored } = recognizeToDraft([], [orphan], []);
    expect(rows).toEqual([]);
    expect(ignored).toEqual([orphan]);
  });

  it("悬空名称行保留 openEnded 标记", () => {
    const { rows } = recognizeToDraft([item({ name: "葡萄", open_ended: true })], [], []);
    expect(rows[0].openEnded).toBe(true);
    expect(rows[0].needsQuantity).toBe(true);
  });
});

describe("appendOcrDraft", () => {
  it("跨张缝合：孤儿数量并入上一张末尾的悬空名称行", () => {
    const first = recognizeToDraft([item({ name: "葡萄", open_ended: true })], [], []);
    const second = recognizeToDraft([], [{ text: "0.8525.965.08", reason: "numeric-only", quantity_text: "0.852", amount_text: "5.08" }], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    expect(result.mergedName).toBe("葡萄");
    expect(result.rows[0]).toMatchObject({ name: "葡萄", quantity: "0.852", priceText: "5.08", needsQuantity: false, openEnded: false });
    expect(result.ignored).toHaveLength(0);
  });

  it("名称悬空但新图没有孤儿数量时保持待补", () => {
    const first = recognizeToDraft([item({ name: "葡萄", open_ended: true })], [], []);
    const second = recognizeToDraft([], [{ text: "合计", reason: "noise" }], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    expect(result.mergedName).toBeNull();
    expect(result.rows[0].needsQuantity).toBe(true);
  });

  it("跨张重复行成对标记疑似重复而不自动删除", () => {
    const first = recognizeToDraft([item({ name: "沙葱", quantity_text: "0.398", price_text: "11.06" })], [], []);
    const second = recognizeToDraft([item({ name: "沙葱", quantity_text: "0.398", price_text: "11.06" })], [], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    // 对称标记：两行互为疑似重复，删掉任意一行后另一行的标记自动解除。
    expect(result.rows[0].duplicate).toBe(true);
    expect(result.rows[1].duplicate).toBe(true);
    const afterRemove = markDuplicates(result.rows.filter((row) => row.id === result.rows[1].id));
    expect(afterRemove[0].duplicate).toBe(false);
  });

  it("同名但金额不同的行不算重复", () => {
    const first = recognizeToDraft([item({ name: "酸奶", quantity_text: "1", price_text: "2.98" })], [], []);
    const second = recognizeToDraft([item({ name: "酸奶", quantity_text: "1", price_text: "3.20" })], [], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    expect(result.rows[1].duplicate).toBe(false);
  });

  it("一方缺金额的同名行仍算疑似重复（分段切分场景）", () => {
    const first = recognizeToDraft([item({ name: "蒜头" })], [], []);
    const second = recognizeToDraft([item({ name: "蒜头", quantity_text: "0.068", price_text: "0.81" })], [], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    expect(result.rows[1].duplicate).toBe(true);
  });

  it("行 id 续号且跳过行跨张合并", () => {
    const first = recognizeToDraft([item({ name: "沙葱", quantity_text: "0.398", price_text: "11.06" })], [{ text: "表头", reason: "header" }], []);
    const second = recognizeToDraft([item({ name: "莴笋", quantity_text: "0.424", price_text: "2.12" })], [{ text: "合计", reason: "noise" }], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    expect(result.rows.map((row) => row.id)).toEqual([1, 2]);
    expect(result.ignored.map((entry) => entry.text)).toEqual(["表头", "合计"]);
  });

  it("超过 30 项时截断并提示", () => {
    const many = Array.from({ length: MAX_OCR_ROWS }, (_, index) => item({ name: `商品${index + 1}`, quantity_text: "1" }));
    const first = recognizeToDraft(many, [], []);
    const second = recognizeToDraft([item({ name: "额外商品", quantity_text: "1" })], [], []);
    const result = appendOcrDraft(first.rows, first.ignored, second);
    expect(result.rows).toHaveLength(MAX_OCR_ROWS);
    expect(result.truncated).toBe(true);
  });
});

describe("markDuplicates 与 editOcrRow", () => {
  const row = (overrides: Partial<OcrDraftRow> & { id: number; name: string }): OcrDraftRow => ({
    quantity: "1", unit: "个", priceText: null, needsQuantity: false, category: null,
    categoryTouched: false, uncertain: false, duplicate: false, openEnded: false,
    ...overrides,
  });

  it("删除重复的一方后，另一方徽标自动解除", () => {
    const rows = [
      row({ id: 1, name: "沙葱", priceText: "11.06" }),
      row({ id: 2, name: "沙葱", priceText: "11.06", duplicate: true }),
    ];
    const after = markDuplicates(rows.filter((r) => r.id === 2));
    expect(after[0].duplicate).toBe(false);
  });

  it("金额缺失的同名行互判重复，删除后解除", () => {
    const rows = [
      row({ id: 1, name: "蒜头" }),
      row({ id: 2, name: "蒜头", priceText: "0.81", duplicate: true }),
    ];
    expect(markDuplicates(rows).every((r) => r.duplicate)).toBe(true);
    expect(markDuplicates(rows.filter((r) => r.id === 2))[0].duplicate).toBe(false);
  });

  it("金额互不相同的同名行不算重复", () => {
    const rows = [
      row({ id: 1, name: "酸奶", priceText: "2.98" }),
      row({ id: 2, name: "酸奶", priceText: "3.20" }),
    ];
    expect(markDuplicates(rows).some((r) => r.duplicate)).toBe(false);
  });

  it("改名后重判重复：撞上已有行则新标，错开则解除", () => {
    const rows = [
      row({ id: 1, name: "虫草花100g盒", priceText: "1.90" }),
      row({ id: 2, name: "宝单花100g盒", priceText: "1.90" }),
    ];
    const renamed = editOcrRow(rows, 2, { name: "虫草花100g盒" }, []);
    expect(renamed[1].duplicate).toBe(true);
    const renamedAway = editOcrRow(renamed, 2, { name: "莴笋" }, []);
    expect(renamedAway[1].duplicate).toBe(false);
  });

  it("改名后未手动改过分类时自动重算分类", () => {
    const rows = [row({ id: 1, name: "宝单花100g盒" })];
    const renamed = editOcrRow(rows, 1, { name: "虫草花100g盒" }, []);
    expect(renamed[0].category).toBe("汤料");
  });

  it("用户手动选过分类后改名不再覆盖", () => {
    const rows = [row({ id: 1, name: "宝单花100g盒", categoryTouched: true, category: "其他" })];
    const renamed = editOcrRow(rows, 1, { name: "虫草花100g盒" }, []);
    expect(renamed[0].category).toBe("其他");
    const touched = editOcrRow([row({ id: 1, name: "土豆", category: "蔬菜" })], 1, { category: "其他" }, []);
    expect(touched[0]).toMatchObject({ category: "其他", categoryTouched: true });
  });

  it("手动补数量后清除待补与待缝合标记", () => {
    const rows = [row({ id: 1, name: "葡萄", quantity: "", needsQuantity: true, openEnded: true })];
    const filled = editOcrRow(rows, 1, { quantity: "0.852" }, []);
    expect(filled[0]).toMatchObject({ needsQuantity: false, openEnded: false });
  });
});

describe("reviewChecklist", () => {
  it("分层统计待办并在清零时报告可保存", () => {
    const rows: OcrDraftRow[] = [
      { id: 1, name: "土豆", quantity: "2", unit: "斤", priceText: null, needsQuantity: false, category: "蔬菜", categoryTouched: false, uncertain: false, duplicate: false, openEnded: false },
      { id: 2, name: "糖果", quantity: "", unit: "", priceText: null, needsQuantity: true, category: null, categoryTouched: false, uncertain: false, duplicate: true, openEnded: false },
    ];
    const checklist = reviewChecklist(rows);
    expect(checklist).toEqual({ total: 2, duplicates: 1, pendingCategory: 1, pendingQuantity: 1, allClear: false });
    expect(reviewChecklist([rows[0]]).allClear).toBe(true);
  });
});
