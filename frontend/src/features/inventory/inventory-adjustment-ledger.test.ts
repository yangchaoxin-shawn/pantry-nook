import { describe, expect, it, vi } from "vitest";
import type { InventoryAdjustmentRecord } from "../../shared/api/client";
import { readInventoryAdjustmentLedger } from "./inventory-adjustment-ledger";

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
