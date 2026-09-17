-- 日常用掉：复用库存处理审计与安全撤销，并为重试提供幂等标识。
ALTER TABLE inventory_adjustments
  DROP CONSTRAINT IF EXISTS inventory_adjustments_reason_check;

ALTER TABLE inventory_adjustments
  ADD CONSTRAINT inventory_adjustments_reason_check
  CHECK (reason IN ('used', 'spoiled', 'damaged', 'other'));

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustments_client_request_id_unique
  ON inventory_adjustments(client_request_id)
  WHERE client_request_id IS NOT NULL;
