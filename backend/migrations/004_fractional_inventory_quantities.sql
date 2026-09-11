-- 实际用量支持 1/2、1/3 等分数；库存与可撤销快照统一保留六位小数。
ALTER TABLE ingredients
  ALTER COLUMN stock_value TYPE NUMERIC(15,6);

ALTER TABLE consumptions
  ALTER COLUMN quantity_value TYPE NUMERIC(15,6),
  ALTER COLUMN remaining_before_value TYPE NUMERIC(15,6),
  ALTER COLUMN remaining_after_value TYPE NUMERIC(15,6);

ALTER TABLE inventory_adjustments
  ALTER COLUMN stock_before_value TYPE NUMERIC(15,6),
  ALTER COLUMN stock_after_value TYPE NUMERIC(15,6);
