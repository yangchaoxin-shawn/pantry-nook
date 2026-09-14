import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CATEGORIES,
  LOCATIONS,
  type Ingredient,
  type IngredientCreate,
  type IngredientUpdate,
} from "../../shared/api/client";
import { Field } from "../../shared/ui/Primitives";
import { canConvertUnits, startedBatchRows } from "./batch-ingredient-logic";
import { applyDefaultUnit, orderedUnits, recommendedUnits } from "./inventory-units";
import { stockLabel } from "./inventory-format";
import { ingredientEditPatch } from "./ingredient-edit-logic";
import { QuantityInput } from "../../shared/ui/QuantityInput";
import { quantityInputError } from "../../shared/ui/quantity-input-logic";

type BatchIngredientRow = {
  id: number;
  name: string;
  quantity: string;
  unit: string;
};
type InventoryConflict = {
  ingredient: Ingredient;
  incomingUnit: string;
  incomingCategory: IngredientCreate["category"];
};

const blankBatchIngredient = (id: number, unit = ""): BatchIngredientRow => ({
  id,
  name: "",
  quantity: "",
  unit,
});

export function IngredientBatchEditor({
  busy,
  single = false,
  suggestedNames = [],
  existingIngredients,
  save,
}: {
  busy: boolean;
  single?: boolean;
  suggestedNames?: string[];
  existingIngredients: Ingredient[];
  save: (
    ingredients: IngredientCreate[],
    resolutions: { ingredient_id: number; unit: string }[],
    categoryResolutions: { ingredient_id: number; category: IngredientCreate["category"] }[],
    manualTotals: { ingredient_id: number; stock_text: string; stock_value: number; unit: string; expected_updated_at: string }[],
  ) => void;
}) {
  const [rows, setRows] = useState(() => suggestedNames.length
    ? suggestedNames.map((name, index) => ({ ...blankBatchIngredient(index + 1), name }))
    : Array.from({ length: single ? 1 : 5 }, (_, index) => blankBatchIngredient(index + 1)),
  );
  const [batchCategory, setBatchCategory] = useState<IngredientCreate["category"]>("蔬菜");
  const [batchLocation, setBatchLocation] = useState<IngredientCreate["location"]>(null);
  const [batchDefaultUnit, setBatchDefaultUnit] = useState("");
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<InventoryConflict[]>([]);
  const [units, setUnits] = useState<Record<number, string>>({});
  const [categories, setCategories] = useState<Record<number, IngredientCreate["category"]>>({});
  const [manualTotals, setManualTotals] = useState<Record<number, string>>({});
  const change = <K extends keyof BatchIngredientRow>(
    id: number,
    key: K,
    value: BatchIngredientRow[K],
  ) => setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filled = startedBatchRows(rows);
    if (!filled.length) {
      setError("先填写至少一项食材。");
      return;
    }
    const incomplete = filled.find((row) => !row.name.trim() || !row.quantity.trim() || !row.unit.trim());
    if (incomplete) {
      setError(`第 ${rows.indexOf(incomplete) + 1} 项请补全食材名、数量和单位。`);
      return;
    }
    const quantityError = filled.map(row => quantityInputError(row.quantity, { required: true })).find(Boolean);
    if (quantityError) {
      setError(quantityError);
      return;
    }
    const ingredients = filled.map((row) => ({
      name: row.name.trim(),
      category: batchCategory,
      stock_text: row.quantity.trim(),
      stock_value: Number(row.quantity),
      stock_unit: row.unit.trim(),
      location: batchLocation,
    }));
    const matches = ingredients.flatMap((item) => {
      const existing = existingIngredients.find((candidate) => candidate.name.trim().toLocaleLowerCase() === item.name.toLocaleLowerCase());
      if (!existing) return [];
      const existingUnit = existing.stock_unit ?? existing.stock_unit;
      return existingUnit !== item.stock_unit || existing.category !== item.category
        ? [{ ingredient: existing, incomingUnit: item.stock_unit ?? "", incomingCategory: item.category }]
        : [];
    });
    setError("");
    if (matches.length) {
      setConflicts(matches);
      setUnits(Object.fromEntries(matches.map(({ ingredient, incomingUnit }) => [ingredient.id, incomingUnit])));
      setCategories(Object.fromEntries(matches.map(({ ingredient }) => [ingredient.id, ingredient.category])));
      setManualTotals({});
      return;
    }
    save(ingredients, [], [], []);
  }
  const draftIngredients = startedBatchRows(rows).map((row) => ({ name: row.name.trim(), category: batchCategory, stock_text: row.quantity.trim(), stock_value: Number(row.quantity), stock_unit: row.unit.trim(), location: batchLocation }));
  if (conflicts.length) {
    const manualTotalMissing = conflicts.some(({ ingredient, incomingUnit }) => {
      const oldUnit = ingredient.stock_unit ?? ingredient.stock_unit ?? "";
      return oldUnit !== incomingUnit && !canConvertUnits(oldUnit, incomingUnit)
        && Boolean(quantityInputError(manualTotals[ingredient.id] ?? "", { required: true }));
    });
    return <div className="batch-resolution">
    <p className="form-notice">发现已有同名食材。请确认分类和单位；保存后只会保留一条库存记录。</p>
    {conflicts.map(({ ingredient, incomingUnit, incomingCategory }) => {
      const oldUnit = ingredient.stock_unit ?? ingredient.stock_unit ?? "";
      const hasCategoryConflict = ingredient.category !== incomingCategory;
      const hasUnitConflict = oldUnit !== incomingUnit;
      const needsManualTotal = hasUnitConflict && !canConvertUnits(oldUnit, incomingUnit);
      return <fieldset key={ingredient.id}><legend>{ingredient.name}</legend><p className="muted">现有 {ingredient.category} · {stockLabel(ingredient)}；本次 {incomingCategory} · {draftIngredients.find(item => item.name.toLocaleLowerCase() === ingredient.name.toLocaleLowerCase())?.stock_text}{incomingUnit}</p>
        {hasCategoryConflict && <><p className="resolution-label">分类</p><div className="unit-choice"><button type="button" className={categories[ingredient.id] === ingredient.category ? "chip active" : "chip"} onClick={() => setCategories(current => ({...current, [ingredient.id]: ingredient.category}))}>保留为 {ingredient.category}</button><button type="button" className={categories[ingredient.id] === incomingCategory ? "chip active" : "chip"} onClick={() => setCategories(current => ({...current, [ingredient.id]: incomingCategory}))}>改为 {incomingCategory}</button></div></>}
        {hasUnitConflict && <><p className="resolution-label">单位</p><div className="unit-choice"><button type="button" className={units[ingredient.id] === oldUnit ? "chip active" : "chip"} onClick={() => setUnits(current => ({...current, [ingredient.id]: oldUnit}))}>统一为 {oldUnit}</button><button type="button" className={units[ingredient.id] === incomingUnit ? "chip active" : "chip"} onClick={() => setUnits(current => ({...current, [ingredient.id]: incomingUnit}))}>统一为 {incomingUnit}</button></div></>}
        {needsManualTotal && <div className="manual-total"><QuantityInput label={`合并后的库存量（${units[ingredient.id]}）`} id={`manual-total-${ingredient.id}`} required disabled={busy} placeholder="按实际库存填写" value={manualTotals[ingredient.id] ?? ""} onValueChange={(value) => setManualTotals(current => ({ ...current, [ingredient.id]: value }))} /><p className="form-hint">这两种单位无法自动换算，请按实际库存填写最终数量。每次增减 1，也可直接输入小数。</p></div>}
        </fieldset>;
    })}
    <div className="actions"><button type="button" className="btn-ghost" onClick={() => setConflicts([])}>返回修改</button><button type="button" className="btn-primary" onClick={() => save(
      draftIngredients,
      conflicts.filter(({ ingredient, incomingUnit }) => (ingredient.stock_unit ?? ingredient.stock_unit ?? "") !== incomingUnit).map(({ ingredient }) => ({ ingredient_id: ingredient.id, unit: units[ingredient.id] })),
      conflicts.filter(({ ingredient, incomingCategory }) => ingredient.category !== incomingCategory).map(({ ingredient }) => ({ ingredient_id: ingredient.id, category: categories[ingredient.id] })),
      conflicts.filter(({ ingredient, incomingUnit }) => {
        const oldUnit = ingredient.stock_unit ?? ingredient.stock_unit ?? "";
        return oldUnit !== incomingUnit && !canConvertUnits(oldUnit, incomingUnit);
      }).map(({ ingredient }) => ({ ingredient_id: ingredient.id, stock_text: manualTotals[ingredient.id].trim(), stock_value: Number(manualTotals[ingredient.id]), unit: units[ingredient.id], expected_updated_at: ingredient.updated_at })),
    )} disabled={busy || manualTotalMissing}>{busy ? "保存中…" : "按选择保存"}</button></div>
  </div>;
  }
  return (
    <form className="batch-ingredient-editor" onSubmit={submit}>
      <div className="batch-category-picker">
        <Field label={single ? "这一项食材属于" : "这一批食材属于"}>
          <select value={batchCategory} onChange={(event) => {
            setBatchCategory(event.target.value as IngredientCreate["category"]);
            setBatchDefaultUnit("");
          }}>
            {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
          </select>
        </Field>
        <Field label={single ? "这一项食材存放在" : "这一批食材存放在"}>
          <select value={batchLocation ?? ""} onChange={(event) => setBatchLocation((event.target.value || null) as IngredientCreate["location"])}>
            <option value="">暂不填写</option>
            {LOCATIONS.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </Field>
        {!single && <Field label="本批默认单位（选填）">
          <select
            value={batchDefaultUnit}
            onChange={(event) => {
              const unit = event.target.value;
              setBatchDefaultUnit(unit);
              setRows((current) => applyDefaultUnit(current, unit));
            }}
          >
            <option value="">每项单独选择</option>
            {recommendedUnits(batchCategory).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </Field>}
        <p className="form-hint">{single ? `这一项食材会归到“${batchCategory}”${batchLocation ? `，存放在“${batchLocation}”` : ""}。` : `下面填写的食材都会归到“${batchCategory}”${batchLocation ? `，存放在“${batchLocation}”` : ""}。`}</p>
      </div>
      <p className="form-hint">{single
        ? `${batchCategory}常用单位：${recommendedUnits(batchCategory).join("、")}；也可以填写其他单位。`
        : `${batchCategory}常用单位：${recommendedUnits(batchCategory).join("、")}；每项可以单独修改，空白行会自动忽略。`}</p>
      <p className="form-hint">数量每次增减 1，也可直接输入 0.5 等小数。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="batch-ingredient-rows">
        {rows.map((row, index) => (
          <div className="batch-ingredient-row" key={row.id}>
            <span className="batch-row-number" aria-hidden="true">{index + 1}</span>
            <input
              aria-label={`第 ${index + 1} 项食材名称`}
              placeholder="食材名"
              maxLength={255}
              value={row.name}
              onChange={(event) => change(row.id, "name", event.target.value)}
            />
            <QuantityInput
              aria-label={`第 ${index + 1} 项数量`}
              disabled={busy}
              placeholder="数量"
              value={row.quantity}
              onValueChange={(value) => change(row.id, "quantity", value)}
            />
            <input
              aria-label={`第 ${index + 1} 项单位`}
              list={`batch-ingredient-units-${batchCategory}`}
              maxLength={50}
              placeholder="单位"
              value={row.unit}
              onChange={(event) => change(row.id, "unit", event.target.value)}
            />
            <button
              type="button"
              className="text-button batch-row-remove"
              aria-label={`清空第 ${index + 1} 项`}
              disabled={busy}
              onClick={() => setRows((current) => current.length === 1 ? [blankBatchIngredient(row.id + 1, batchDefaultUnit)] : current.filter((entry) => entry.id !== row.id))}
            >
              清空
            </button>
          </div>
        ))}
      </div>
      <datalist id={`batch-ingredient-units-${batchCategory}`}>
        {orderedUnits(batchCategory).map((unit) => <option key={unit} value={unit} />)}
      </datalist>
      {!single && <button
        type="button"
        className="btn-ghost batch-add-row"
        disabled={busy || rows.length >= 30}
        onClick={() => setRows((current) => [...current, blankBatchIngredient(Math.max(...current.map((row) => row.id)) + 1, batchDefaultUnit)])}
      >
        再加一行
      </button>}
      <button className="btn-primary submit" disabled={busy}>
        {busy ? "保存中…" : single ? "保存食材" : "保存这批食材"}
      </button>
    </form>
  );
}
export function IngredientEditor({
  item,
  busy,
  blocked,
  focusLocation = false,
  save,
}: {
  item: Ingredient;
  busy: boolean;
  blocked?: boolean;
  focusLocation?: boolean;
  save: (payload: IngredientUpdate) => void;
}) {
  const [original] = useState(item);
  const locationRef = useRef<HTMLSelectElement>(null);
  const [quantity, setQuantity] = useState(String(item.stock_value));
  const [unit, setUnit] = useState(item.stock_unit);
  const [category, setCategory] = useState<IngredientCreate["category"]>(item.category);
  useEffect(() => {
    if (!focusLocation) return;
    const frame = requestAnimationFrame(() => locationRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusLocation]);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch = ingredientEditPatch(original, item, {
      name: String(f.get("name")),
      category: f.get("category") as IngredientCreate["category"],
      location: (f.get("location") || null) as Ingredient["location"],
      note: String(f.get("note") || "") || null,
      quantity,
      unit,
    });
    save(patch);
  }
  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <Field label="食材名称">
          <input
            name="name"
            required
            maxLength={255}
            defaultValue={item?.name}
            placeholder="例如：鸡蛋"
          />
        </Field>
        <Field label="分类">
          <select name="category" value={category} onChange={(event) => setCategory(event.target.value as IngredientCreate["category"])}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="存放位置">
          <select ref={locationRef} name="location" defaultValue={item?.location ?? ""}>
            <option value="">未填写</option>
            {LOCATIONS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend>当前库存</legend>
        <div className="form-grid">
            <QuantityInput
              label="数量"
              name="quantity"
              required
              disabled={busy}
              allowZero={original.stock_value === 0 && quantity === "0" && unit === original.stock_unit}
              value={quantity}
              onValueChange={setQuantity}
              placeholder="例如：6"
            />
          <Field label="单位">
            <input
              name="stock_unit"
              required
              list={`ingredient-units-${category}`}
              maxLength={50}
              value={unit}
              onChange={event => setUnit(event.target.value)}
              placeholder="例如：个"
            />
          </Field>
        </div>
        <p className="form-hint">{category}常用单位：{recommendedUnits(category).join("、")}；也可以填写其他单位。</p>
        <p className="form-hint">数量每次增减 1，也可直接输入小数。修改单位时，请核对当前实际数量。</p>
        <datalist id={`ingredient-units-${category}`}>
          {orderedUnits(category).map((unit) => <option key={unit} value={unit} />)}
        </datalist>
      </fieldset>
      <Field label="备注（选填）">
        <textarea
          name="note"
          maxLength={5000}
          rows={2}
          defaultValue={item?.note ?? ""}
        />
      </Field>
      <button
        className="btn-primary submit"
        disabled={busy || blocked}
      >
        {busy ? "保存中…" : "保存食材"}
      </button>
    </form>
  );
}
