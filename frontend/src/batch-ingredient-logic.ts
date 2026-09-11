export type BatchRowInput = {
  name: string;
  quantity: string;
};

const UNIT_GROUP: Record<string, string> = {
  g: "mass",
  kg: "mass",
  斤: "mass",
  ml: "volume",
  L: "volume",
};

/**
 * 只有明确属于同一量纲的单位才允许自动换算。
 * “个”“块”等未登记单位不能因为同样缺少量纲而被误判为可换算。
 */
export function canConvertUnits(source: string | null | undefined, target: string | null | undefined): boolean {
  if (source === target) return true;
  if (!source || !target) return false;
  const sourceGroup = UNIT_GROUP[source];
  const targetGroup = UNIT_GROUP[target];
  return Boolean(sourceGroup && targetGroup && sourceGroup === targetGroup);
}

/** 默认单位不代表用户填过一行；只有食材名或数量出现才进入校验与保存。 */
export function startedBatchRows<T extends BatchRowInput>(rows: T[]): T[] {
  return rows.filter((row) => row.name.trim() !== "" || row.quantity.trim() !== "");
}
