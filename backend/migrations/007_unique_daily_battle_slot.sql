-- 一天的早餐、午餐、晚餐各只有一份菜单。旧测试记录不在迁移中删除或合并。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM daily_battles WHERE meal_slot IS NULL) THEN
    RAISE EXCEPTION '无法升级：存在未指定餐次的菜单，请先补齐餐次后重试';
  END IF;
END;
$$;

ALTER TABLE daily_battles ALTER COLUMN meal_slot SET NOT NULL;
CREATE INDEX IF NOT EXISTS daily_battles_date_slot_idx ON daily_battles(battle_date, meal_slot);

CREATE OR REPLACE FUNCTION enforce_daily_battle_slot_unique()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.battle_date IS NOT DISTINCT FROM OLD.battle_date
     AND NEW.meal_slot IS NOT DISTINCT FROM OLD.meal_slot
     AND NOT (OLD.status IS DISTINCT FROM 'planned' AND NEW.status = 'planned') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.battle_date::text), hashtext(NEW.meal_slot));
  IF EXISTS (
    SELECT 1 FROM daily_battles
     WHERE battle_date = NEW.battle_date
       AND meal_slot = NEW.meal_slot
       AND id <> COALESCE(NEW.id, 0)
  ) THEN
    RAISE EXCEPTION '同一日期和餐次只能有一份菜单'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS battles_require_unique_date_slot ON daily_battles;
CREATE TRIGGER battles_require_unique_date_slot
BEFORE INSERT OR UPDATE OF battle_date, meal_slot, status ON daily_battles
FOR EACH ROW
EXECUTE FUNCTION enforce_daily_battle_slot_unique();
