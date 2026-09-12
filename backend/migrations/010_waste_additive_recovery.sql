-- 报废允许补回原库存 ID；整餐跨记录合并仍要求来源和目标不同。
DO $$
DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN
  SELECT conname FROM pg_constraint
  WHERE conrelid='inventory_recovery_merges'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%source_ingredient_id <> target_ingredient_id%'
 LOOP
  EXECUTE format('ALTER TABLE inventory_recovery_merges DROP CONSTRAINT %I', constraint_name);
 END LOOP;
END $$;
ALTER TABLE inventory_recovery_merges ADD CONSTRAINT recovery_target_identity
 CHECK (source_ingredient_id <> target_ingredient_id OR adjustment_id IS NOT NULL);
