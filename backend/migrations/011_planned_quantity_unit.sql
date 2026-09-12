-- 保存菜单时记录库存单位，避免之后库存改单位导致旧预计量被静默换义。
ALTER TABLE daily_battle_preparations
  ADD COLUMN IF NOT EXISTS planned_quantity_unit VARCHAR(50);

UPDATE daily_battle_preparations AS preparation
   SET planned_quantity_unit = ingredient.stock_unit
  FROM ingredients AS ingredient
 WHERE preparation.ingredient_id = ingredient.id
   AND preparation.planned_quantity_unit IS NULL;
