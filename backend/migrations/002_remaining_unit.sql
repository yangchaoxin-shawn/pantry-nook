ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS remaining_unit VARCHAR(50);
UPDATE ingredients SET remaining_unit = quantity_unit WHERE remaining_unit IS NULL;
