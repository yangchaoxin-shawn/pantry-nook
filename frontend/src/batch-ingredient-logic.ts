export type BatchRowInput = {
  name: string;
  quantity: string;
};

/** 默认单位不代表用户填过一行；只有食材名或数量出现才进入校验与保存。 */
export function startedBatchRows<T extends BatchRowInput>(rows: T[]): T[] {
  return rows.filter((row) => row.name.trim() !== "" || row.quantity.trim() !== "");
}
