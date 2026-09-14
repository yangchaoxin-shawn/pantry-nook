import { describe, expect, it } from "vitest";
import type { Ingredient } from "../../shared/api/client";
import { ingredientEditPatch } from "./ingredient-edit-logic";

const original: Ingredient = {
  id: 1, name: "菠菜", category: "蔬菜", location: null, note: null,
  stock_text: "1/2", stock_value: 0.5, stock_unit: "kg",
  created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z",
};
const draft = { name: original.name, category: original.category, location: original.location, note: original.note, quantity: "0.5", unit: "kg" };

describe("编辑库存按用户改动提交", () => {
  it("只改单位也能成组提交，不要求数值发生变化且保留分数原文", () => {
    expect(ingredientEditPatch(original, original, { ...draft, unit: "斤" })).toEqual({
      expected_updated_at: original.updated_at, stock_text: "1/2", stock_value: 0.5, stock_unit: "斤",
    });
  });
  it("只改数量也同时提交未改变的单位", () => {
    expect(ingredientEditPatch(original, original, { ...draft, quantity: "2.25" })).toEqual({
      expected_updated_at: original.updated_at, stock_text: "2.25", stock_value: 2.25, stock_unit: "kg",
    });
  });
  it("只改位置或名称不发送库存字段，不把 1/2 变为 0.5", () => {
    expect(ingredientEditPatch(original, original, { ...draft, location: "冰箱冷藏" })).toEqual({
      expected_updated_at: original.updated_at, location: "冰箱冷藏",
    });
    expect(ingredientEditPatch(original, original, { ...draft, name: "新鲜菠菜" })).toEqual({
      expected_updated_at: original.updated_at, name: "新鲜菠菜",
    });
  });
  it("完全无变动仅保留版本，显式修改数字格式则保留用户新原文", () => {
    expect(ingredientEditPatch(original, original, draft)).toEqual({ expected_updated_at: original.updated_at });
    expect(ingredientEditPatch(original, original, { ...draft, quantity: "0.500" })).toEqual({
      expected_updated_at: original.updated_at, stock_text: "0.500", stock_value: 0.5, stock_unit: "kg",
    });
  });
  it("原文自带单位时只更换单位后缀，不猜单位换算", () => {
    const withUnit = { ...original, stock_text: "1/2 kg" };
    expect(ingredientEditPatch(withUnit, withUnit, { ...draft, unit: "g" })).toEqual({
      expected_updated_at: original.updated_at, stock_text: "1/2 g", stock_value: 0.5, stock_unit: "g",
    });
  });
  it("用户核对冲突后使用最新版本，未动库存不覆盖其他设备的新数量", () => {
    const latest = { ...original, stock_text: "3", stock_value: 3, updated_at: "2026-09-14T01:00:00Z" };
    expect(ingredientEditPatch(original, latest, { ...draft, location: "室温" })).toEqual({
      expected_updated_at: latest.updated_at, location: "室温",
    });
  });
});
