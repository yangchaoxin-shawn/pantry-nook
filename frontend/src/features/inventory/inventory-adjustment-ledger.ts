import type { InventoryAdjustmentRecord } from "../../shared/api/client";

export type InventoryAdjustmentLedgerState =
  | { status: "loading" }
  | { status: "ready"; records: InventoryAdjustmentRecord[] }
  | { status: "error"; message: string };

export type InventoryAdjustmentDayGroup = {
  key: string;
  label: string;
  records: InventoryAdjustmentRecord[];
};

const chineseWeekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function parsedDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function inventoryAdjustmentDateLabel(value: string, today = new Date()): string {
  const date = parsedDate(value);
  if (!date) return "日期待确认";
  const dateText = `${date.getMonth() + 1}月${date.getDate()}日`;
  const relative = localDayKey(date) === localDayKey(today) ? "今天 · " : "";
  const year = date.getFullYear() === today.getFullYear() ? "" : `${date.getFullYear()}年`;
  return `${relative}${year}${dateText} · ${chineseWeekdays[date.getDay()]}`;
}

export function inventoryAdjustmentTimeLabel(value: string): string {
  const date = parsedDate(value);
  if (!date) return "时间待确认";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function inventoryAdjustmentMomentLabel(value: string): string {
  const date = parsedDate(value);
  if (!date) return "时间待确认";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${inventoryAdjustmentTimeLabel(value)}`;
}

export function groupInventoryAdjustmentRecords(
  records: InventoryAdjustmentRecord[],
  today = new Date(),
): InventoryAdjustmentDayGroup[] {
  const sorted = [...records].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const groups = new Map<string, InventoryAdjustmentDayGroup>();
  for (const record of sorted) {
    const date = parsedDate(record.created_at);
    const key = date ? localDayKey(date) : "unknown";
    const existing = groups.get(key);
    if (existing) {
      existing.records.push(record);
    } else {
      groups.set(key, {
        key,
        label: inventoryAdjustmentDateLabel(record.created_at, today),
        records: [record],
      });
    }
  }
  return [...groups.values()];
}

export async function readInventoryAdjustmentLedger(
  read: () => Promise<InventoryAdjustmentRecord[]>,
): Promise<InventoryAdjustmentLedgerState> {
  try {
    return { status: "ready", records: await read() };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "读取失败",
    };
  }
}
