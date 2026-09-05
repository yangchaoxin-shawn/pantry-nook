-- 厨房助手数据库结构（MVP v0.2）

CREATE TABLE IF NOT EXISTS ingredients (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  quantity_text VARCHAR(255) NOT NULL,
  quantity_value NUMERIC(12, 3),
  quantity_unit VARCHAR(50),
  remaining_text VARCHAR(255),
  remaining_value NUMERIC(12, 3),
  location VARCHAR(50),
  purchase_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  ended_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ingredients_status_check
    CHECK (status IN ('active', 'consumed', 'discarded')),
  CONSTRAINT ingredients_quantity_value_check
    CHECK (quantity_value IS NULL OR quantity_value >= 0),
  CONSTRAINT ingredients_remaining_value_check
    CHECK (remaining_value IS NULL OR remaining_value >= 0)
);

CREATE TABLE IF NOT EXISTS meal_records (
  id BIGSERIAL PRIMARY KEY,
  meal_date DATE NOT NULL,
  meal_type VARCHAR(20),
  title VARCHAR(255),
  dishes JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meal_records_meal_type_check
    CHECK (meal_type IS NULL OR meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  CONSTRAINT meal_records_dishes_array_check
    CHECK (jsonb_typeof(dishes) = 'array' AND jsonb_array_length(dishes) > 0)
);

CREATE TABLE IF NOT EXISTS consumptions (
  id BIGSERIAL PRIMARY KEY,
  consumed_date DATE NOT NULL,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  meal_record_id BIGINT REFERENCES meal_records(id) ON DELETE SET NULL,
  quantity_used_text VARCHAR(255) NOT NULL,
  quantity_value NUMERIC(12, 3),
  quantity_unit VARCHAR(50),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumptions_quantity_value_check
    CHECK (quantity_value IS NULL OR quantity_value > 0)
);

CREATE TABLE IF NOT EXISTS recommended_dishes (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  main_ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recommended_dishes_ingredients_array_check
    CHECK (jsonb_typeof(main_ingredients) = 'array')
);

CREATE INDEX IF NOT EXISTS ingredients_status_idx ON ingredients(status);
CREATE INDEX IF NOT EXISTS ingredients_category_idx ON ingredients(category);
CREATE INDEX IF NOT EXISTS ingredients_location_idx ON ingredients(location);
CREATE INDEX IF NOT EXISTS ingredients_purchase_date_idx ON ingredients(purchase_date DESC);
CREATE INDEX IF NOT EXISTS meal_records_meal_date_idx ON meal_records(meal_date DESC);
CREATE INDEX IF NOT EXISTS consumptions_consumed_date_idx ON consumptions(consumed_date DESC);
CREATE INDEX IF NOT EXISTS consumptions_ingredient_id_idx ON consumptions(ingredient_id);
CREATE INDEX IF NOT EXISTS consumptions_meal_record_id_idx ON consumptions(meal_record_id);
