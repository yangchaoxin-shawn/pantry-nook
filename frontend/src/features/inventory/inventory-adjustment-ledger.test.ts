import { describe, expect, it, vi } from "vitest";
import type { InventoryAdjustmentRecord } from "../../shared/api/client";
import {
  groupInventoryAdjustmentRecords,
  inventoryAdjustmentDateLabel,
  inventoryAdjustmentMomentLabel,
  inventoryAdjustmentTimeLabel,
  readInventoryAdjustmentLedger,
} from "./inventory-adjustment-ledger";

const record = { id: 1, ingredient_name: "番茄" } as InventoryAdjustmentRecord;

describe("库存处理记录读取", () => {
  it("失败后重新读取成功时只保留最新记录，不残留旧错误", async () => {
    const read = vi.fn<() => Promise<InventoryAdjustmentRecord[]>>()
      .mockRejectedValueOnce(new Error("暂时断开连接"))
      .mockResolvedValueOnce([record]);

    expect(await readInventoryAdjustmentLedger(read)).toEqual({
      status: "error",
      message: "暂时断开连接",
    });
    expect(await readInventoryAdjustmentLedger(read)).toEqual({
      status: "ready",
      records: [record],
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("库存处理记录时间线", () => {
  const makeRecord = (id: number, created_at: string) => ({ id, created_at, ingredient_name: `食材${id}` }) as InventoryAdjustmentRecord;

  it("按发生日期分组，并在每组内保持从新到旧", () => {
    const groups = groupInventoryAdjustmentRecords([
      makeRecord(1, "2026-09-13T09:10:00"),
      makeRecord(2, "2026-09-14T08:00:00"),
      makeRecord(3, "2026-09-13T18:20:00"),
    ], new Date("2026-09-14T12:00:00"));

    expect(groups).toHaveLength(2);
    expect(groups[0]?.records.map((item) => item.id)).toEqual([2]);
    expect(groups[0]?.label).toContain("今天");
    expect(groups[1]?.records.map((item) => item.id)).toEqual([3, 1]);
  });

  it("日期、时间和撤销时刻使用简洁的中文标签", () => {
    expect(inventoryAdjustmentDateLabel("2026-09-14T08:05:00", new Date("2026-09-14T12:00:00"))).toContain("9月14日");
    expect(inventoryAdjustmentTimeLabel("2026-09-14T08:05:00")).toBe("08:05");
    expect(inventoryAdjustmentMomentLabel("2026-09-14T08:05:00")).toBe("2026年9月14日 08:05");
  });

  it("遇到无法识别的时间仍给出可理解的占位", () => {
    expect(inventoryAdjustmentDateLabel("invalid")).toBe("日期待确认");
    expect(inventoryAdjustmentTimeLabel("invalid")).toBe("时间待确认");
  });
});
