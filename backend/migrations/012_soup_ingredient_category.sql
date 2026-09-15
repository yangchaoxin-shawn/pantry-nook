-- 汤料按家庭主要烹饪用途作为独立库存大类；保留既有分类和值。
ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_category_check;
ALTER TABLE ingredients
  ADD CONSTRAINT ingredients_category_check
  CHECK (category IN ('碳水', '蔬菜', '蛋白质', '水果', '汤料', '其他'));
