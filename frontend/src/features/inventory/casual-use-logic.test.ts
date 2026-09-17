import { describe, expect, it } from "vitest";
import { casualUseAll, casualUseHalf, casualUseRemaining } from "./casual-use-logic";

describe("日常用掉数量快捷操作", () => {
  it("一半按库存六位精度取最接近的可记录数量", () => {
    expect(casualUseHalf(0.3)).toBe("0.15");
    expect(casualUseHalf(0.333333)).toBe("0.166667");
    expect(casualUseHalf(0.000001)).toBeNull();
  });

  it("全部和扣后余量不显示浮点尾差", () => {
    expect(casualUseAll(1)).toBe("1");
    expect(casualUseRemaining(0.3, "0.2")).toBe("0.1");
    expect(casualUseRemaining(1, "1")).toBe("0");
    expect(casualUseRemaining(1, "1.1")).toBeNull();
  });
});
