-- 库存 V1：统一 stock_* 字段，报废独立记账。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ingredients WHERE status='active'
    GROUP BY LOWER(btrim(name)) HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '库存迁移中止：存在同名在库食材，请先人工合并后再执行';
  END IF;
END $$;

UPDATE ingredients
SET remaining_text=COALESCE(remaining_text, quantity_text),
    remaining_value=COALESCE(remaining_value, quantity_value),
    remaining_unit=COALESCE(remaining_unit, quantity_unit);

ALTER TABLE ingredients RENAME COLUMN remaining_text TO stock_text;
ALTER TABLE ingredients RENAME COLUMN remaining_value TO stock_value;
ALTER TABLE ingredients RENAME COLUMN remaining_unit TO stock_unit;
ALTER TABLE ingredients DROP COLUMN quantity_text;
ALTER TABLE ingredients DROP COLUMN quantity_value;
ALTER TABLE ingredients DROP COLUMN quantity_unit;
ALTER TABLE ingredients DROP COLUMN purchase_date;

DROP INDEX IF EXISTS ingredients_purchase_date_idx;
CREATE UNIQUE INDEX ingredients_active_normalized_name_unique
  ON ingredients (LOWER(btrim(name))) WHERE status='active';

CREATE TABLE inventory_adjustments (
  id BIGSERIAL PRIMARY KEY,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  reason VARCHAR(20) NOT NULL CHECK (reason IN ('spoiled','damaged','other')),
  note TEXT,
  stock_before_text VARCHAR(255) NOT NULL,
  stock_before_value NUMERIC(12,3) NOT NULL,
  stock_before_unit VARCHAR(50) NOT NULL,
  stock_after_text VARCHAR(255) NOT NULL,
  stock_after_value NUMERIC(12,3) NOT NULL,
  stock_after_unit VARCHAR(50) NOT NULL,
  stock_after_updated_at TIMESTAMPTZ NOT NULL,
  ingredient_status_before VARCHAR(20) NOT NULL,
  ingredient_ended_at_before TIMESTAMPTZ,
  ingredient_status_after VARCHAR(20) NOT NULL,
  ingredient_ended_at_after TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX inventory_adjustments_ingredient_idx ON inventory_adjustments(ingredient_id, created_at DESC);
