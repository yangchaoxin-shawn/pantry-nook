import { describe, expect, it } from "vitest";
import { canConvertUnits, convertUnitValue, startedBatchRows } from "./batch-ingredient-logic";

describe("批量食材单位冲突", () => {
  it("只自动换算明确属于同一量纲的单位", () => {
    expect(canConvertUnits("g", "kg")).toBe(true);
    expect(canConvertUnits("ml", "L")).toBe(true);
    expect(canConvertUnits("个", "个")).toBe(true);
  });

  it("按已登记单位换算数量", () => {
    expect(convertUnitValue(1, "kg", "g")).toBe(1000);
    expect(convertUnitValue(1, "个", "块")).toBeNull();
  });

  it("要求为不可换算单位填写合并后的实际库存", () => {
    expect(canConvertUnits("个", "块")).toBe(false);
    expect(canConvertUnits("kg", "个")).toBe(false);
    expect(canConvertUnits("袋", "盒")).toBe(false);
  });

  it("忽略完全空白的批量行", () => {
    expect(startedBatchRows([{ name: "", quantity: "" }, { name: "菠菜", quantity: "2" }])).toHaveLength(1);
  });
});
