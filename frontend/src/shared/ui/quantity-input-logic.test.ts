import { describe, expect, it } from "vitest";
import { quantityInputError, stepQuantity } from "./quantity-input-logic";

describe("数量快捷调整与输入精度", () => {
  it("每次改变 1，保留已有半份和六位小数，不跳到整数或产生浮点尾差", () => {
    expect(stepQuantity("2", 1)).toBe("3");
    expect(stepQuantity("0.5", 1)).toBe("1.5");
    expect(stepQuantity("2.123456", -1)).toBe("1.123456");
    expect(stepQuantity("0.000001", 1)).toBe("1.000001");
    expect(stepQuantity(".25", 1)).toBe("1.25");
    expect(stepQuantity("2.123456000", 1)).toBe("3.123456");
  });
  it("快捷调整不舍入手填量，也不越过正数、最大库存及存储边界", () => {
    expect(stepQuantity("0.25", -1)).toBe("0.25");
    expect(stepQuantity("1", -1)).toBe("1");
    expect(stepQuantity("1", -1, { allowZero: true })).toBe("0");
    expect(stepQuantity("1.5", 1, { max: 2 })).toBe("1.5");
    expect(stepQuantity("999999999.999999", 1)).toBe("999999999.999999");
    expect(stepQuantity("2.0000001", 1)).toBe("2.0000001");
  });
  it("空白可从 1 开始；半份上限时留给用户输入实际量", () => {
    expect(stepQuantity("", 1)).toBe("1");
    expect(stepQuantity("", -1)).toBe("");
    expect(stepQuantity("", 1, { max: 0.5 })).toBe("");
  });
  it("保存允许非 1 或 0.5 倍数的小数，原有六位精度不减少", () => {
    expect(quantityInputError("0.25", { required: true })).toBe("");
    expect(quantityInputError("0.000001", { required: true })).toBe("");
    expect(quantityInputError("0.2500000", { required: true })).toBe("");
    expect(quantityInputError("999999999.999999")).toBe("");
    expect(quantityInputError("0.0000001")).not.toBe("");
    expect(quantityInputError("1000000000")).not.toBe("");
  });
  it("空白行可忽略，必填、非法数字、零值和报废上限仍校验", () => {
    expect(quantityInputError("")).toBe("");
    expect(quantityInputError("", { required: true })).not.toBe("");
    expect(quantityInputError("NaN")).not.toBe("");
    expect(quantityInputError("1e3")).not.toBe("");
    expect(quantityInputError("-1")).not.toBe("");
    expect(quantityInputError("0")).not.toBe("");
    expect(quantityInputError("0", { allowZero: true })).toBe("");
    expect(quantityInputError("0.6", { max: 0.5 })).not.toBe("");
  });
});
