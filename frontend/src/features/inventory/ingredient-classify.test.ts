import { describe, expect, it } from "vitest";
import { CATEGORY_KEYWORDS, classifyIngredientName, normalizeIngredientName } from "./ingredient-classify";

describe("normalizeIngredientName", () => {
  it("剥掉票面规格与乘数残留", () => {
    expect(normalizeIngredientName("虫草花100g盒")).toBe("虫草花");
    expect(normalizeIngredientName("风行杯装乐悠黄桃味酸奶180g")).toBe("风行杯装乐悠黄桃味酸奶");
    expect(normalizeIngredientName("精选石橄榄100g")).toBe("精选石橄榄");
    expect(normalizeIngredientName("抽纸×2")).toBe("抽纸");
    expect(normalizeIngredientName("[惠]黄心土豆")).toBe("黄心土豆");
  });
});

describe("classifyIngredientName", () => {
  it("在库同名食材优先于词表", () => {
    const known = [{ name: "虫草花", category: "汤料" }];
    expect(classifyIngredientName("虫草花100g盒", known)).toBe("汤料");
  });

  it("在库与票名互相包含时命中（土豆 ↔ 黄心土豆）", () => {
    const known = [{ name: "黄心土豆", category: "蔬菜" }];
    expect(classifyIngredientName("土豆", known)).toBe("蔬菜");
    expect(classifyIngredientName("黄心土豆/KG", known)).toBe("蔬菜");
  });

  it("完全同名优先于包含匹配，包含匹配取最具体的一条", () => {
    // 按名称排序时"土豆"排在"土豆丝"前面，不能让包含关系抢先命中。
    const known = [{ name: "土豆", category: "蔬菜" }, { name: "土豆丝", category: "其他" }];
    expect(classifyIngredientName("土豆丝", known)).toBe("其他");
    const nested = [{ name: "土豆", category: "蔬菜" }, { name: "黄心土豆", category: "其他" }];
    expect(classifyIngredientName("有机黄心土豆", nested)).toBe("其他");
  });

  it("原名完全相同的优先于归一化同名（入库合并的就是这一条）", () => {
    // 已吃完的"风行酸奶"按名称排在在库的"风行酸奶180g"前面，不能抢先命中。
    const known = [{ name: "风行酸奶", category: "其他" }, { name: "风行酸奶180g", category: "蛋白质" }];
    expect(classifyIngredientName("风行酸奶180g", known)).toBe("蛋白质");
  });

  it("包含匹配优先取习惯名是票名一部分的方向", () => {
    const known = [{ name: "土豆", category: "蔬菜" }, { name: "黄心土豆丝", category: "其他" }];
    expect(classifyIngredientName("黄心土豆", known)).toBe("蔬菜");
  });

  it("票名是习惯名一部分时取最接近的一条（牛奶配纯牛奶，不配牛奶饼干）", () => {
    const known = [{ name: "牛奶饼干", category: "其他" }, { name: "纯牛奶", category: "蛋白质" }];
    expect(classifyIngredientName("牛奶", known)).toBe("蛋白质");
  });

  it("单字在库食材不参与包含匹配，避免误配", () => {
    const known = [{ name: "葱", category: "蔬菜" }];
    expect(classifyIngredientName("香葱", known)).toBe("蔬菜");
    const knownSingle = [{ name: "蛋", category: "蛋白质" }];
    // 单字"蛋"只参与精确匹配；"蛋糕"由词表归碳水。
    expect(classifyIngredientName("蛋糕", knownSingle)).toBe("碳水");
    expect(classifyIngredientName("蛋", knownSingle)).toBe("蛋白质");
  });

  it("词表最长匹配优先（土鸡蛋 → 蛋白质）", () => {
    expect(classifyIngredientName("土鸡蛋", [])).toBe("蛋白质");
    expect(classifyIngredientName("五指毛桃切节", [])).toBe("汤料");
    expect(classifyIngredientName("黄心土豆", [])).toBe("蔬菜");
    expect(classifyIngredientName("乐悠黄桃味酸奶", [])).toBe("蛋白质");
    expect(classifyIngredientName("散装大米", [])).toBe("碳水");
  });

  it("匹配不到返回 null 待分类", () => {
    expect(classifyIngredientName("进口保健品礼盒", [])).toBeNull();
    expect(classifyIngredientName("   ", [{ name: "土豆", category: "蔬菜" }])).toBeNull();
  });

  it("词表各分类非空且不含跨类重复词", () => {
    const seen = new Map<string, string>();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      expect(keywords.length, `${category} 词表不应为空`).toBeGreaterThan(0);
      for (const keyword of keywords) {
        const owner = seen.get(keyword);
        expect(owner, `词条「${keyword}」同时出现在 ${owner} 与 ${category}`).toBeUndefined();
        seen.set(keyword, category);
      }
    }
  });
});
