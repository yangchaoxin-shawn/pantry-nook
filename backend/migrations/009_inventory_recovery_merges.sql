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
 CHECK (source_ingredient_id <> target_ingredient_id)
);
