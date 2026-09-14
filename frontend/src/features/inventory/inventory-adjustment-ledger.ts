import type { InventoryAdjustmentRecord } from "../../shared/api/client";

export type InventoryAdjustmentLedgerState =
  | { status: "loading" }
  | { status: "ready"; records: InventoryAdjustmentRecord[] }
  | { status: "error"; message: string };

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
