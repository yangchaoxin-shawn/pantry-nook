-- 核对用料时锁定可用库存；确认前不扣减 ingredients.stock_*。
CREATE TABLE IF NOT EXISTS daily_battle_review_locks (
  id BIGSERIAL PRIMARY KEY,
  daily_battle_id BIGINT NOT NULL REFERENCES daily_battles(id) ON DELETE CASCADE,
  daily_battle_dish_id BIGINT NOT NULL,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity_value NUMERIC(15,6) NOT NULL CHECK (quantity_value >= 0),
  stock_unit VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (daily_battle_dish_id, ingredient_id),
  FOREIGN KEY (daily_battle_dish_id, daily_battle_id)
    REFERENCES daily_battle_dishes(id, daily_battle_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS review_locks_ingredient_expiry_idx
  ON daily_battle_review_locks(ingredient_id, expires_at);
