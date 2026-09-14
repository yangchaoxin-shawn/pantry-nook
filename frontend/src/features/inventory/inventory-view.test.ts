import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Ingredient } from "../../shared/api/client";
import { InventoryPage } from "./InventoryPages";
import { inventoryView, LOCATION_OPTIONS } from "./inventory-view";

const ingredient = (id: number, name: string, category: Ingredient["category"], location: Ingredient["location"]): Ingredient => ({
  id, name, category, location, stock_text: "1/2", stock_value: 0.5, stock_unit: "kg", note: null,
  created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z",
});
const ingredients = [ingredient(1, "回归白菜", "蔬菜", "冰箱冷藏"), ingredient(2, "回归燕麦", "碳水", "室温"), ingredient(3, "回归虾", "蛋白质", "冰箱冷冻")];
const base = { ingredients, locationItems: null, inventoryLocation: null, locationError: "", search: "", category: "全部" };

describe("库存筛选读取状态", () => {
  it("位置请求尚无结果时显示加载，即使搜索本来就不匹配", () => {
    expect(inventoryView({ ...base, inventoryLocation: "冰箱冷藏", search: "不存在" })).toEqual({ status: "loading" });
  });
  it("请求失败返回错误，不能误报该位置没有库存", () => {
    expect(inventoryView({ ...base, inventoryLocation: "冰箱冷藏", locationItems: [], locationError: "网络断开" })).toEqual({ status: "error", message: "网络断开" });
  });
  it("位置请求成功且数组为空时才显示真实空态", () => {
    expect(inventoryView({ ...base, inventoryLocation: "其他", locationItems: [] })).toEqual({ status: "empty" });
  });
  it("快速切到冷冻时不显示旧冷藏结果，也不把不匹配结果当空态", () => {
    expect(inventoryView({ ...base, inventoryLocation: "冰箱冷冻", locationItems: [ingredients[0]] })).toEqual({ status: "loading" });
  });
  it("切回全部位置立即使用完整库存，不沿用位置请求的错误与旧结果", () => {
    const view = inventoryView({ ...base, locationItems: [], locationError: "上一位置断线" });
    expect(view.status).toBe("ready");
    if (view.status === "ready") expect(view.groups.flatMap((group) => group.items).map((item) => item.id).sort()).toEqual([1, 2, 3]);
  });
  it("位置、类别和搜索同时生效，并保留数量原文及原始对象", () => {
    const view = inventoryView({ ...base, inventoryLocation: "冰箱冷藏", locationItems: [ingredients[0]], category: "蔬菜", search: " 白菜 " });
    expect(view.status).toBe("ready");
    if (view.status === "ready") {
      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].items[0]).toBe(ingredients[0]);
      expect(view.groups[0].items[0].stock_text).toBe("1/2");
    }
    expect(inventoryView({ ...base, inventoryLocation: "冰箱冷藏", locationItems: [ingredients[0]], category: "水果" })).toEqual({ status: "empty" });
  });
  it("按现有类别顺序分组，不改 API 数组顺序", () => {
    const view = inventoryView(base);
    if (view.status !== "ready") throw new Error("预期有库存");
    expect(view.groups.map((group) => group.category)).toEqual(["碳水", "蔬菜", "蛋白质"]);
    expect(ingredients.map((item) => item.id)).toEqual([1, 2, 3]);
  });
  it("短位置标签仍对应既有 API 值", () => {
    expect(LOCATION_OPTIONS.find((option) => option.label === "冷藏")?.value).toBe("冰箱冷藏");
    expect(LOCATION_OPTIONS.find((option) => option.label === "冷冻")?.value).toBe("冰箱冷冻");
    expect(LOCATION_OPTIONS.find((option) => option.label === "全部位置")?.value).toBeNull();
  });
});

describe("库存组件状态呈现", () => {
  const props = { ...base, setSearch: vi.fn(), setCategory: vi.fn(), chooseLocation: vi.fn(), retry: vi.fn(), openIngredient: vi.fn() };
  it("加载态包含忙碌提示，没有空态或旧食材", () => {
    const html = renderToStaticMarkup(createElement(InventoryPage, { ...props, inventoryLocation: "冰箱冷藏" }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在读取冷藏食材");
    expect(html).not.toContain("没有找到");
    expect(html).not.toContain("回归白菜");
  });
  it("错误态提供重试且不渲染空态", () => {
    const html = renderToStaticMarkup(createElement(InventoryPage, { ...props, inventoryLocation: "冰箱冷藏", locationItems: [], locationError: "连接失败" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("重新读取");
    expect(html).not.toContain("没有找到");
  });
  it("位置先于类别，可接入动作，详情入口带真实数量和单位", () => {
    const html = renderToStaticMarkup(createElement(InventoryPage, { ...props, actions: createElement("button", {}, "单个记录") }));
    expect(html.indexOf('aria-label="存放位置"')).toBeLessThan(html.indexOf('aria-label="食材分类"'));
    expect(html).toContain("单个记录");
    expect(html).toContain('aria-label="查看回归白菜，余量1/2kg"');
    expect(html).not.toContain("1 项");
  });
});
