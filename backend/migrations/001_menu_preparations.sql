ALTER TABLE daily_battles ADD COLUMN IF NOT EXISTS meal_slot VARCHAR(20)
  CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner'));

CREATE TABLE IF NOT EXISTS daily_battle_preparations (
  id BIGSERIAL PRIMARY KEY,
  daily_battle_dish_id BIGINT NOT NULL REFERENCES daily_battle_dishes(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  planned_quantity_text VARCHAR(255),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (daily_battle_dish_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS preparations_ingredient_idx ON daily_battle_preparations(ingredient_id);
CREATE INDEX IF NOT EXISTS battles_date_slot_idx ON daily_battles(battle_date DESC, meal_slot);
