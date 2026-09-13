import { useState, type FormEvent } from "react";
import type { Dish, MealPlan, MealPlanInput } from "../../shared/api/client";
import { Field } from "../../shared/ui/Primitives";

function DishPicker({ dishes, selected, setSelected }: { dishes: Dish[]; selected: number[]; setSelected: (ids: number[]) => void }) {
  return <fieldset className="dish-picker">
    <legend>选择菜品 · 已选 {selected.length} 道</legend>
    {dishes.length === 0 ? <p>请先到菜品库保存一道菜。</p> : dishes.map((dish) => <label className={`choice ${selected.includes(dish.id) ? "selected" : ""}`} key={dish.id}>
      <input type="checkbox" checked={selected.includes(dish.id)} onChange={() => setSelected(selected.includes(dish.id) ? selected.filter((id) => id !== dish.id) : [...selected, dish.id])} />
      {dish.name}
    </label>)}
  </fieldset>;
}

export function CatalogEditor({ item, dishes, busy, blocked, savePlan }: { item?: MealPlan; dishes: Dish[]; busy: boolean; blocked?: boolean; savePlan: (payload: MealPlanInput) => void }) {
  const [selected, setSelected] = useState<number[]>(item?.dishes.map((dish) => dish.id) ?? []);
  const unavailable = selected.filter((id) => !dishes.some((dish) => dish.id === id));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    savePlan({ name: String(form.get("name") || "") || null, dish_ids: selected, ...(item ? { expected_updated_at: item.updated_at } : {}) });
  }
  return <form onSubmit={submit}>
    <Field label="搭配名称（选填）"><input name="name" maxLength={255} defaultValue={item?.name ?? ""} placeholder="给这个组合起个名字" /></Field>
    <DishPicker dishes={dishes} selected={selected} setSelected={setSelected} />
    {unavailable.length > 0 && <p className="form-error">部分菜品已删除，请重新选择。<button type="button" className="text-button" onClick={() => setSelected(selected.filter((id) => dishes.some((dish) => dish.id === id)))}>移除失效选择</button></p>}
    <p className="form-hint">搭配是模板，修改不会改变已创建的菜单。</p>
    <button className="btn-primary submit" disabled={busy || blocked || selected.length === 0 || unavailable.length > 0}>{busy ? "保存中…" : "保存搭配"}</button>
  </form>;
}
