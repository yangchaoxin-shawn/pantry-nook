-- 相同菜品集合只保留一个常用搭配；菜品显示顺序不参与唯一性判断。
ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS dish_signature TEXT;

UPDATE meal_plans p
SET dish_signature = signatures.value
FROM (
  SELECT meal_plan_id,
         string_agg(dish_id::text, ',' ORDER BY dish_id) AS value
  FROM meal_plan_dishes
  GROUP BY meal_plan_id
) signatures
WHERE signatures.meal_plan_id = p.id
  AND p.dish_signature IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM meal_plans
    WHERE dish_signature IS NULL OR btrim(dish_signature) = ''
  ) THEN
    RAISE EXCEPTION '存在没有菜品的搭配，请先补充菜品后再迁移';
  END IF;
END $$;

-- 对历史完全重复记录保留最早一条；已有菜单改为引用保留记录。
WITH ranked AS (
  SELECT id,
         MIN(id) OVER (PARTITION BY dish_signature) AS keeper_id
  FROM meal_plans
)
UPDATE daily_battles battle
SET meal_plan_id = ranked.keeper_id
FROM ranked
WHERE battle.meal_plan_id = ranked.id
  AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         MIN(id) OVER (PARTITION BY dish_signature) AS keeper_id
  FROM meal_plans
)
DELETE FROM meal_plans plan
USING ranked
WHERE plan.id = ranked.id
  AND ranked.id <> ranked.keeper_id;

-- 相同名称但菜品不同不能安全自动合并，拒绝猜测用户意图。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM meal_plans
    WHERE name IS NOT NULL
    GROUP BY LOWER(btrim(name))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '存在同名但菜品不同的搭配，请先修改名称后再迁移';
  END IF;
END $$;

ALTER TABLE meal_plans
  ALTER COLUMN dish_signature SET NOT NULL;

ALTER TABLE meal_plans
  DROP CONSTRAINT IF EXISTS meal_plans_dish_signature_check;
ALTER TABLE meal_plans
  ADD CONSTRAINT meal_plans_dish_signature_check CHECK (btrim(dish_signature) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_dish_signature_unique
  ON meal_plans (dish_signature);

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_normalized_name_unique
  ON meal_plans (LOWER(btrim(name)))
  WHERE name IS NOT NULL;

