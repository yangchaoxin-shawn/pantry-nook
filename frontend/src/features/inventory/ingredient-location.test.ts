import { describe, expect, it } from "vitest";
import { CATEGORY_DEFAULT_LOCATION, LOCATION_KEYWORDS, suggestLocation } from "./ingredient-location";

const habit = (name: string, category: string, location: string | null) => ({ name, category, location });

describe("suggestLocation", () => {
  it("同名食材按你的记录填，来源为习惯", () => {
    expect(suggestLocation("沙葱/KG", "蔬菜", [habit("沙葱", "蔬菜", "冰箱冷冻")]))
      .toEqual({ location: "冰箱冷冻", source: "habit" });
  });

  it("你改过一次位置后，同名食材按你的来，覆盖内置关键词", () => {
    // 内置认为土豆放室温；你把黄心土豆放进了冷藏，之后的土豆都跟你走。
    expect(suggestLocation("土豆", "蔬菜", [habit("黄心土豆", "蔬菜", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷藏", source: "habit" });
  });

  it("同名记录没有位置时，继续往下一层找", () => {
    expect(suggestLocation("莴笋", "蔬菜", [habit("莴笋", "蔬菜", null)]))
      .toEqual({ location: "冰箱冷藏", source: "guess" });
  });

  it("在库原名完全相同的记录优先，保存合并时不会改掉它的位置", () => {
    const habits = [habit("风行酸奶", "蛋白质", "室温"), habit("风行酸奶180g", "蛋白质", "冰箱冷藏")];
    expect(suggestLocation("风行酸奶180g", "蛋白质", habits)).toEqual({ location: "冰箱冷藏", source: "habit" });
  });

  it("票名多出冷藏、冷冻类关键词且指向别的位置时，按关键词推测（冷冻鸡翅不照搬鸡翅放冷藏）", () => {
    expect(suggestLocation("冷冻鸡翅", "蛋白质", [habit("鸡翅", "蛋白质", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷冻", source: "guess" });
    expect(suggestLocation("冻豆腐", "蛋白质", [habit("豆腐", "蛋白质", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷冻", source: "guess" });
  });

  it("室温类关键词多是口味或配料，不推翻你的习惯", () => {
    expect(suggestLocation("紫薯馒头", "碳水", [habit("馒头", "碳水", "冰箱冷冻")]))
      .toEqual({ location: "冰箱冷冻", source: "habit" });
    expect(suggestLocation("香蕉牛奶", "蛋白质", [habit("牛奶", "蛋白质", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷藏", source: "habit" });
    expect(suggestLocation("菠萝味酸奶", "蛋白质", [habit("酸奶", "蛋白质", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷藏", source: "habit" });
  });

  it("多出的关键词与习惯位置一致时仍算你的习惯（速冻水饺对放冷冻的水饺）", () => {
    expect(suggestLocation("湾仔码头速冻水饺", "碳水", [habit("水饺", "碳水", "冰箱冷冻")]))
      .toEqual({ location: "冰箱冷冻", source: "habit" });
  });

  it("习惯名多出冷藏、冷冻类关键词且位置正由它决定时，不照搬", () => {
    // 冷冻鸡翅放冷冻是因为"冷冻"；新鲜鸡翅往下按同类推测。
    expect(suggestLocation("鸡翅", "蛋白质", [habit("冷冻鸡翅", "蛋白质", "冰箱冷冻")]))
      .toEqual({ location: "冰箱冷藏", source: "guess" });
    expect(suggestLocation("猪肉", "蛋白质", [habit("猪肉水饺", "碳水", "冰箱冷冻")]))
      .toEqual({ location: "冰箱冷藏", source: "guess" });
    // 你把冷冻鸡翅放冷藏，位置不是由"冷冻"决定的，照你的来。
    expect(suggestLocation("鸡翅", "蛋白质", [habit("冷冻鸡翅", "蛋白质", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷藏", source: "habit" });
  });

  it("室温类关键词只认名称结尾的主体，冷藏、冷冻类在任何位置都生效", () => {
    expect(suggestLocation("紫皮洋葱", "蔬菜", [])).toEqual({ location: "室温", source: "guess" });
    expect(suggestLocation("土豆丝", "蔬菜", [])).toEqual({ location: "冰箱冷藏", source: "guess" });
    expect(suggestLocation("香蕉牛奶250ml", "蛋白质", [])).toEqual({ location: "冰箱冷藏", source: "guess" });
    expect(suggestLocation("芒果冰淇淋", "其他", [])).toEqual({ location: "冰箱冷冻", source: "guess" });
  });

  it("室温主体后面跟着规格或称重说明时照样生效", () => {
    for (const name of ["土豆/500g", "土豆/斤", "土豆约500g", "土豆散装", "蒜头", "荔浦芋头"]) {
      expect(suggestLocation(name, "蔬菜", []), name).toEqual({ location: "室温", source: "guess" });
    }
    for (const name of ["香蕉1把", "香蕉一把"]) {
      expect(suggestLocation(name, "水果", []), name).toEqual({ location: "室温", source: "guess" });
    }
  });

  it("你专门记过的完全同名食材仍按你的来（冷冻鸡翅放冷藏解冻）", () => {
    expect(suggestLocation("冷冻鸡翅", "蛋白质", [habit("冷冻鸡翅", "蛋白质", "冰箱冷藏")]))
      .toEqual({ location: "冰箱冷藏", source: "habit" });
  });

  it("没有同名记录时，按内置关键词推测具体食材", () => {
    expect(suggestLocation("[惠]黄心土豆/KG", "蔬菜", [])).toEqual({ location: "室温", source: "guess" });
    expect(suggestLocation("湾仔码头速冻水饺", "碳水", [])).toEqual({ location: "冰箱冷冻", source: "guess" });
    expect(suggestLocation("筒骨", "汤料", [])).toEqual({ location: "冰箱冷冻", source: "guess" });
  });

  it("具体食材的内置判断先于同类多数（洋葱第一次出现放室温）", () => {
    const habits = [habit("白菜", "蔬菜", "冰箱冷藏"), habit("菠菜", "蔬菜", "冰箱冷藏"), habit("芹菜", "蔬菜", "冰箱冷藏")];
    expect(suggestLocation("洋葱", "蔬菜", habits)).toEqual({ location: "室温", source: "guess" });
  });

  it("同类有足够记录时按你的同类多数填，来源为习惯", () => {
    const habits = [habit("苹果", "水果", "室温"), habit("橙子", "水果", "室温"), habit("梨", "水果", "室温")];
    expect(suggestLocation("芒果", "水果", habits)).toEqual({ location: "室温", source: "habit" });
  });

  it("同类记录不足或没有过半的位置时，用内置分类默认", () => {
    const tooFew = [habit("苹果", "水果", "室温"), habit("橙子", "水果", "室温")];
    expect(suggestLocation("芒果", "水果", tooFew)).toEqual({ location: "冰箱冷藏", source: "guess" });
    const split = [habit("苹果", "水果", "室温"), habit("橙子", "水果", "冰箱冷藏"), habit("梨", "水果", "其他")];
    expect(suggestLocation("芒果", "水果", split)).toEqual({ location: "冰箱冷藏", source: "guess" });
  });

  it("待分类且无同名和关键词依据时不填", () => {
    expect(suggestLocation("神秘商品", null, [])).toBeNull();
  });

  it("每个分类都有默认位置，关键词不跨位置重复", () => {
    for (const category of ["蔬菜", "水果", "蛋白质", "碳水", "汤料", "其他"] as const) {
      expect(CATEGORY_DEFAULT_LOCATION[category]).toBeTruthy();
    }
    const seen = new Map<string, string>();
    for (const [location, keywords] of Object.entries(LOCATION_KEYWORDS)) {
      for (const keyword of keywords) {
        expect(seen.get(keyword), `关键词「${keyword}」同时出现在 ${seen.get(keyword)} 与 ${location}`).toBeUndefined();
        seen.set(keyword, location);
      }
    }
  });
});
