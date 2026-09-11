-- 菜单可记录待购买耗材；核对和确认均不再预占库存。
ALTER TABLE daily_battle_preparations
  ALTER COLUMN ingredient_id DROP NOT NULL;
ALTER TABLE daily_battle_preparations
  ADD COLUMN IF NOT EXISTS pending_ingredient_name VARCHAR(255);
ALTER TABLE daily_battle_preparations
  DROP CONSTRAINT IF EXISTS daily_battle_preparations_source_check;
ALTER TABLE daily_battle_preparations
  ADD CONSTRAINT daily_battle_preparations_source_check CHECK (
    (ingredient_id IS NOT NULL AND pending_ingredient_name IS NULL)
    OR (ingredient_id IS NULL AND btrim(pending_ingredient_name) <> '')
  );
DROP TABLE IF EXISTS daily_battle_review_locks;
