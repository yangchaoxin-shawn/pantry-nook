-- 食隅记数据库结构（PRD v0.3）

CREATE TABLE IF NOT EXISTS ingredients (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  stock_text VARCHAR(255) NOT NULL,
  stock_value NUMERIC(15, 6),
  stock_unit VARCHAR(50),
  location VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  ended_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ingredients_status_check
    CHECK (status IN ('active', 'consumed', 'discarded')),
  CONSTRAINT ingredients_category_check
    CHECK (category IN ('碳水', '蔬菜', '蛋白质', '水果', '其他')),
  CONSTRAINT ingredients_stock_value_check
    CHECK (stock_value IS NULL OR stock_value >= 0)
);

-- 菜品库只保存可反复选择的菜品名称，删除通过软删除保留历史关系。
CREATE TABLE IF NOT EXISTS dishes (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dishes_name_check CHECK (btrim(name) <> '')
);

ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_category_check;
ALTER TABLE ingredients
  ADD CONSTRAINT ingredients_category_check
  CHECK (category IN ('碳水', '蔬菜', '蛋白质', '水果', '其他'));

-- 搭配方案是菜品模板，不直接关联库存。
CREATE TABLE IF NOT EXISTS meal_plans (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255),
  dish_signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meal_plans_name_check CHECK (name IS NULL OR btrim(name) <> ''),
  CONSTRAINT meal_plans_dish_signature_check CHECK (btrim(dish_signature) <> '')
);

CREATE TABLE IF NOT EXISTS meal_plan_dishes (
  meal_plan_id BIGINT NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  dish_id BIGINT NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY (meal_plan_id, dish_id),
  CONSTRAINT meal_plan_dishes_position_check CHECK (position >= 0),
  CONSTRAINT meal_plan_dishes_position_unique UNIQUE (meal_plan_id, position)
);

-- 一条记录对应某日某一餐；同一日期和餐次只允许一份菜单。
CREATE TABLE IF NOT EXISTS daily_battles (
  id BIGSERIAL PRIMARY KEY,
  battle_date DATE NOT NULL,
  meal_plan_id BIGINT REFERENCES meal_plans(id) ON DELETE SET NULL,
  meal_slot VARCHAR(20) NOT NULL CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner')),
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_battles_status_check
    CHECK (status IN ('planned', 'confirmed', 'cancelled')),
  CONSTRAINT daily_battles_status_timestamp_check
    CHECK (
      (status = 'confirmed' AND confirmed_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND confirmed_at IS NULL AND cancelled_at IS NOT NULL)
      OR (status = 'planned' AND confirmed_at IS NULL AND cancelled_at IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS daily_battle_dishes (
  id BIGSERIAL PRIMARY KEY,
  daily_battle_id BIGINT NOT NULL REFERENCES daily_battles(id) ON DELETE CASCADE,
  dish_id BIGINT NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT,
  dish_name VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_battle_dishes_position_check CHECK (position >= 0),
  CONSTRAINT daily_battle_dishes_position_unique UNIQUE (daily_battle_id, position),
  CONSTRAINT daily_battle_dishes_dish_unique UNIQUE (daily_battle_id, dish_id),
  CONSTRAINT daily_battle_dishes_id_battle_unique UNIQUE (id, daily_battle_id)
);

CREATE TABLE IF NOT EXISTS daily_battle_preparations (
  id BIGSERIAL PRIMARY KEY,
  daily_battle_dish_id BIGINT NOT NULL REFERENCES daily_battle_dishes(id) ON DELETE CASCADE,
  ingredient_id BIGINT REFERENCES ingredients(id) ON DELETE RESTRICT,
  pending_ingredient_name VARCHAR(255),
  planned_quantity_text VARCHAR(255),
  planned_quantity_unit VARCHAR(50),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (daily_battle_dish_id, ingredient_id),
  CONSTRAINT daily_battle_preparations_source_check CHECK (
    (ingredient_id IS NOT NULL AND pending_ingredient_name IS NULL)
    OR (ingredient_id IS NULL AND btrim(pending_ingredient_name) <> '')
  )
);
CREATE INDEX IF NOT EXISTS preparations_ingredient_idx ON daily_battle_preparations(ingredient_id);

-- 消耗只能在今日作战确认时产生，数量保留用户填写的原文。
CREATE TABLE IF NOT EXISTS consumptions (
  id BIGSERIAL PRIMARY KEY,
  daily_battle_id BIGINT NOT NULL REFERENCES daily_battles(id) ON DELETE RESTRICT,
  daily_battle_dish_id BIGINT,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity_used_text VARCHAR(255) NOT NULL,
  quantity_value NUMERIC(15, 6),
  quantity_unit VARCHAR(50),
  note TEXT,
  remaining_before_text VARCHAR(255),
  remaining_before_value NUMERIC(15, 6),
  remaining_after_text VARCHAR(255),
  remaining_after_value NUMERIC(15, 6),
  ingredient_status_before VARCHAR(20) NOT NULL,
  ingredient_ended_at_before TIMESTAMPTZ,
  ingredient_status_after VARCHAR(20) NOT NULL,
  ingredient_ended_at_after TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumptions_status_check
    CHECK (status IN ('active', 'reversed')),
  CONSTRAINT consumptions_status_timestamp_check
    CHECK (
      (status = 'active' AND reversed_at IS NULL)
      OR (status = 'reversed' AND reversed_at IS NOT NULL)
    ),
  CONSTRAINT consumptions_battle_dish_fk
    FOREIGN KEY (daily_battle_dish_id, daily_battle_id)
    REFERENCES daily_battle_dishes(id, daily_battle_id)
    ON DELETE RESTRICT,
  CONSTRAINT consumptions_quantity_value_check
    CHECK (quantity_value IS NULL OR quantity_value > 0)
);

ALTER TABLE consumptions
  ADD COLUMN IF NOT EXISTS remaining_before_text VARCHAR(255),
  ADD COLUMN IF NOT EXISTS remaining_before_value NUMERIC(15, 6),
  ADD COLUMN IF NOT EXISTS remaining_after_text VARCHAR(255),
  ADD COLUMN IF NOT EXISTS remaining_after_value NUMERIC(15, 6),
  ADD COLUMN IF NOT EXISTS ingredient_status_before VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ingredient_ended_at_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingredient_status_after VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ingredient_ended_at_after TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS dishes_active_name_idx
  ON dishes (LOWER(btrim(name)))
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_dish_signature_unique ON meal_plans (dish_signature);
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_normalized_name_unique ON meal_plans (LOWER(btrim(name))) WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS ingredients_status_idx ON ingredients(status);
CREATE INDEX IF NOT EXISTS ingredients_category_idx ON ingredients(category);
CREATE INDEX IF NOT EXISTS ingredients_location_idx ON ingredients(location);
CREATE UNIQUE INDEX IF NOT EXISTS ingredients_active_normalized_name_unique ON ingredients (LOWER(btrim(name))) WHERE status='active';
CREATE INDEX IF NOT EXISTS meal_plan_dishes_dish_id_idx ON meal_plan_dishes(dish_id);
CREATE INDEX IF NOT EXISTS daily_battles_status_idx ON daily_battles(status);
CREATE INDEX IF NOT EXISTS daily_battles_date_slot_idx ON daily_battles(battle_date, meal_slot);
CREATE INDEX IF NOT EXISTS daily_battle_dishes_dish_id_idx ON daily_battle_dishes(dish_id);
CREATE INDEX IF NOT EXISTS consumptions_battle_id_idx ON consumptions(daily_battle_id);
CREATE INDEX IF NOT EXISTS consumptions_ingredient_id_idx ON consumptions(ingredient_id);

CREATE OR REPLACE FUNCTION enforce_daily_battle_consumption_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  battle_status VARCHAR(20);
BEGIN
  SELECT status
    INTO battle_status
    FROM daily_battles
   WHERE id = NEW.daily_battle_id
   FOR UPDATE;

  IF battle_status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION '消耗只能关联已确认的今日作战'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consumptions_require_confirmed_battle ON consumptions;
CREATE TRIGGER consumptions_require_confirmed_battle
BEFORE INSERT OR UPDATE OF daily_battle_id, status ON consumptions
FOR EACH ROW
EXECUTE FUNCTION enforce_daily_battle_consumption_state();

CREATE OR REPLACE FUNCTION prevent_battle_unconfirmation_with_active_consumptions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('planned', 'cancelled')
     AND OLD.status = 'confirmed'
     AND EXISTS (
       SELECT 1
         FROM consumptions
        WHERE daily_battle_id = OLD.id
          AND status = 'active'
     ) THEN
    RAISE EXCEPTION '今日作战仍有未撤销的消耗记录，不能撤销确认'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS battles_require_reversed_consumptions ON daily_battles;
CREATE TRIGGER battles_require_reversed_consumptions
BEFORE UPDATE OF status ON daily_battles
FOR EACH ROW
EXECUTE FUNCTION prevent_battle_unconfirmation_with_active_consumptions();

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

CREATE TABLE IF NOT EXISTS inventory_adjustments (id BIGSERIAL PRIMARY KEY, ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT, reason VARCHAR(20) NOT NULL CHECK (reason IN ('spoiled','damaged','other')), note TEXT, stock_before_text VARCHAR(255) NOT NULL, stock_before_value NUMERIC(15,6) NOT NULL, stock_before_unit VARCHAR(50) NOT NULL, stock_after_text VARCHAR(255) NOT NULL, stock_after_value NUMERIC(15,6) NOT NULL, stock_after_unit VARCHAR(50) NOT NULL, stock_after_updated_at TIMESTAMPTZ NOT NULL, ingredient_status_before VARCHAR(20) NOT NULL, ingredient_ended_at_before TIMESTAMPTZ, ingredient_status_after VARCHAR(20) NOT NULL, ingredient_ended_at_after TIMESTAMPTZ, status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','reversed')), reversed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS inventory_adjustments_ingredient_idx ON inventory_adjustments(ingredient_id,created_at DESC);

CREATE TABLE inventory_recovery_merges (
 id BIGSERIAL PRIMARY KEY,
 adjustment_id BIGINT UNIQUE REFERENCES inventory_adjustments(id),
 consumption_id BIGINT UNIQUE REFERENCES consumptions(id),
 source_ingredient_id BIGINT NOT NULL REFERENCES ingredients(id),
 target_ingredient_id BIGINT NOT NULL REFERENCES ingredients(id),
 restored_text TEXT NOT NULL, restored_value NUMERIC(15,6) NOT NULL CHECK(restored_value >= 0), restored_unit TEXT NOT NULL,
 target_before_text TEXT NOT NULL, target_before_value NUMERIC(15,6) NOT NULL, target_before_unit TEXT NOT NULL,
 target_after_text TEXT NOT NULL, target_after_value NUMERIC(15,6) NOT NULL CHECK(target_after_value > 0), target_after_unit TEXT NOT NULL,
 calculation_mode TEXT NOT NULL CHECK(calculation_mode IN ('converted','manual')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK ((adjustment_id IS NULL) <> (consumption_id IS NULL)),
 CONSTRAINT recovery_target_identity CHECK (source_ingredient_id <> target_ingredient_id OR adjustment_id IS NOT NULL)
);
