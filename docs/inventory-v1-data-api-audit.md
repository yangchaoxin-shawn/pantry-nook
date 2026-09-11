# 库存 V1 数据模型与 API 审核

> 历史记录（2026-09-11 归类）：保留当时方案与证据，正文可能含过期规则、数据和验证计数。当前业务以 [PRD](PRD.md) 为准，当前阶段见 [项目状态](project-status.md)；本文不授权重新执行数据或部署操作。

日期：2026-09-10
状态：**已实施并通过隔离服务冒烟测试**

本文件只审计库存模块。菜单、菜品、搭配和消耗历史不在本轮改动范围内。

## 1. V1 的产品边界

库存页解决一个问题：**家里现在有什么，以及还剩多少。**

- 按碳水、蔬菜、蛋白质、水果、其他分组。
- 清单只显示食材名和当前库存量；详情展示少量补充信息。
- 单个记录和批量记录都是入库入口；同名食材只能保留一条当前库存。
- 菜单保存不扣库存；菜单确定时才在事务中扣减库存。
- 不在库存页面展示消耗明细、丢弃明细或后端生命周期状态。

## 2. 当前真实结构

`ingredients` 当前字段按职责可分为：

| 组别 | 当前字段 | 审核结论 |
|---|---|---|
| 身份 | `id`、`name`、`category` | 保留 |
| 当前库存 | `stock_text`、`stock_value`、`stock_unit` | 唯一库存事实 |
| 首次录入快照 | 无 | 已移除；当前库存不再维护重复数量字段 |
| 补充信息 | `location`、`note` | 仅在详情或编辑时按需显示 |
| 后端生命周期 | `status`、`ended_at`、`created_at`、`updated_at` | 保留给事务、历史和并发校验；不作为库存详情内容 |

后端已经具备：分类约束、非负数约束、菜单未确认时禁止手改库存、确认和撤销时的库存快照。`remaining_unit` 已通过增量 migration 补齐。

## 3. 发现的问题

1. **两套数量字段含义重叠。** 目前写入时同时维护 `quantity_*` 与 `remaining_*`，前端也有回退读取。用户看到的是“当前库存”，因此应只以迁移后的 `stock_*` 为准。
2. **同名唯一性没有数据库约束。** 当前 API 会合并同名在库食材，但数据库没有“在库食材名称唯一”的索引。未来脚本、并发或新接口可能绕开该规则。
3. **API 直接返回表行。** `status`、`ended_at`、旧数量快照等内部字段被前端看到，造成“为什么有状态”的体验问题。
4. **冲突请求结构分散。** 当前批量接口用 `unit_resolutions`、`category_resolutions`、`manual_totals` 三个平行数组表达一次同名冲突处理；可运行，但不利于长期维护。
5. **手动用完/丢弃接口与 V1 心智不一致。** 后端仍保留接口，但库存 V1 的主路径是菜单确定或直接编辑当前库存，不需要把内部生命周期作为日常操作入口。

只读检查当前业务库：有 6 条 `active` 食材，未发现名称标准化后的重复在库记录；因此可以在迁移中安全地预检并建立唯一约束。今后仍必须由 migration 重新检查，不能把这次结果当成永久保证。

## 4. 建议冻结的数据模型

### 4.1 数据库事实

| 概念 | 数据库字段 | 规则 |
|---|---|---|
| 食材名称 | `name` | 去首尾空格、大小写不敏感；每个 `active` 食材唯一 |
| 大类 | `category` | 限定五类 |
| 当前库存原文 | `stock_text` | 保留用户确认的显示原文 |
| 当前库存可计算值 | `stock_value` | 数字库存时写入，非负 |
| 当前库存单位 | `stock_unit` | 与当前库存原文配套 |
| 可选补充 | `location`、`note` | 只在详情或编辑时出现 |
| 内部状态 | `status`、`ended_at` | 仅用于库存是否可消耗、历史与撤销 |

Migration `003_inventory_v1_stock_and_adjustments.sql` 已将当前库存收敛为 `stock_*`，并建立仅对 `active` 食材生效的标准化名称唯一索引。消费记录的 `remaining_before_*`、`remaining_after_*` 仍是历史快照，不受影响。

### 4.2 同名规则

1. 名称相同且都在库时，系统只保留一条记录。
2. 分类相同、单位相同：自动累加。
3. 分类不同：弹窗选择保留旧分类或改为本次分类。
4. 单位可换算（`g/kg/斤`、`ml/L`）：弹窗选择最终单位后自动合并。
5. 单位不可换算（如 `个` 与 `kg`）：弹窗选择最终单位，并填写最终实际库存量；系统不猜测换算。
6. 任何冲突处理都在同一数据库事务内完成，不能创建第二条在库同名食材。

## 5. 建议冻结的 API 形态

库存核心字段建议在数据库和 API 使用**同一套产品名称**，避免小项目里再维护一层无意义的字段映射：

```text
InventoryItem
  id, name, category
  stock_text, stock_value, stock_unit
  location?, note?
  updated_at
```

建议通过 migration 将 `ingredients.remaining_*` 更名为 `ingredients.stock_*`，API 同样使用 `stock_*`。消费记录里的 `remaining_before_*`、`remaining_after_*` 是历史快照，名称保留不动。`quantity_*` 仍暂存为旧数据兼容字段。

### 5.1 读取

- `GET /api/ingredients`：默认只返回在库库存摘要，不返回 `status`、`ended_at`、`quantity_*`。
- `GET /api/ingredients/{id}`：返回详情 DTO；不把内部生命周期字段展示给日常客户端。
- 菜单服务内部仍可按状态读取可消耗库存，不通过浏览器拼接条件。

### 5.2 写入

- 单个记录与批量记录继续共用一个批量写入服务；区别只在前端交互。
- 请求使用 `stock_text`、`stock_value`、`stock_unit`，不再让客户端理解 `quantity_*` 与 `remaining_*`。
- 同名冲突采用一个 `resolutions` 数组，每项包含既有库存 ID、最终分类、最终单位，以及不可换算时必填的最终库存量。
- 记录成功后返回 `InventoryItem`。

### 5.3 不作为 V1 日常入口的接口

- `POST /api/ingredients/{id}/consume`
- `POST /api/ingredients/{id}/discard`

这两个入口已移除，没有保留兼容路由。数据库 `status` 继续保留给事务和历史；菜单确认后库存为零时仍由后端安全更新。

## 6. 已实施的 migration 与 API

1. Migration 先检测重复的 `active` 标准化名称；有重复即停止，不自动合并或删除。
2. 在通过预检后创建唯一部分索引，并将旧库存字段收敛为 `stock_*`。
3. `POST /api/ingredients/batch` 使用 `{ items, resolutions }`；单个记录复用这个 API。
4. `POST /api/ingredients/{id}/waste` 记录变质/损坏；`GET /api/ingredients/{id}/adjustments` 读取记录；`POST /api/ingredients/adjustments/{adjustment_id}/revoke` 安全撤销。
5. 菜单确认请求的 `ingredient_totals` 也使用 `stock_text`、`stock_value`；后端仅在消费历史里保存 `remaining_*` 快照。

不会重置数据库，不会删除已有食材、菜单或消耗历史。

## 7. 需要产品确认的三项选择

| 事项 | 推荐 | 影响 |
|---|---|---|
| 详情补充信息 | 保留可选“存放位置、备注”；不再录入或展示购入日期 | 页面更简单，仍能解决食材放在哪里的问题 |
| 手动用完/丢弃 | 移除旧的泛化入口，替换为明确的“处理变质/损坏” | 菜单消耗、库存编辑、食材报废三条路径语义清晰 |
| API 与数据库命名 | 核心库存统一采用 `stock_*` | 一个概念一套名称；历史快照字段和旧兼容字段例外 |

## 8. 已确认方向与待确认的报废能力

用户已确认：保留可选“存放位置、备注”，不再录入或展示购入日期；库存核心字段应采用同一套 `stock_*` 命名。

### 8.1 产品含义

新增一个前端入口：**处理变质/损坏**。它处理已经不能再吃的食材，支持：

- **全部处理**：例如一盒豆腐全部变质。
- **处理部分**：例如 6 个鸡蛋坏了 2 个。
- 原因：`变质`、`损坏`、`其他`；可选备注。

它不是菜单消耗，也不伪装成普通编辑库存。库存清单仍只显示剩余可用库存；报废过程和原因集中在独立的“库存处理记录”中，食材详情提供“变质/损坏记录”快捷入口。

主流产品通常将这类动作建模为带原因的库存调整：Shopify 区分“设为指定数量”和“按差额调整”，并明确支持移除损坏、丢失或过期库存；Square 将损坏调整建模为 `IN_STOCK → WASTE` 的有原因状态变化。[Shopify inventory adjustments](https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/adjusting-inventory-quantities) [Square adjustment reasons](https://developer.squareup.com/docs/inventory-api/adjustment-reasons)

### 8.2 数据模型

新增 `inventory_adjustments`，不复用菜单 `consumptions`：

```text
id
ingredient_id
kind = 'waste'
reason = 'spoiled' | 'damaged' | 'other'
quantity_text, quantity_value, quantity_unit
stock_before_text, stock_before_value, stock_before_unit
stock_after_text, stock_after_value, stock_after_unit
note?
created_at
reversed_at?
```

报废数量必须是正数、不得超过当前库存，且单位必须等于该食材的当前库存单位。全部报废后，库存置零并将内部状态设为 `discarded`；部分报废后仍为 `active`。

### 8.3 API

前端只使用直观入口：

```text
POST /api/ingredients/{id}/waste
{
  quantity_text, quantity_value, quantity_unit,
  reason, note?, expected_updated_at
}
```

服务端同时提供全局和单食材两种查询，历史记录使用 `inventory_adjustments`，不混入菜单消耗。报废与菜单确认一样，必须带版本号以拒绝过期页面覆盖新库存。

```text
GET /api/inventory-adjustments
GET /api/ingredients/{id}/adjustments
```

全局查询按“可撤销处理优先、处理历史随后”的顺序返回，并保留已报废食材的名称与分类。因此食材全部报废、从 `GET /api/ingredients` 消失后，用户仍能在全局记录中找到并撤销该次处理。

### 8.4 状态与事务

`active → waste adjustment → active（部分） / discarded（全部）`

- 锁定该食材和库存工作流。
- 有未确认菜单时拒绝手动报废，避免菜单耗材与当前库存相互覆盖；用户需先修改或取消那份菜单。
- 一次事务写调整记录、更新库存和内部状态；任一步失败全部回滚。
- 可撤销最近一次报废，但仅在此后没有新的库存变化时允许，防止错误恢复覆盖新数据。

### 8.5 migration 与安全

实施时新增 `inventory_adjustments` 表、外键、原因约束、索引，以及库存状态与调整记录的一致性保护；不会删除旧菜单、消耗或食材数据。服务未做登录与权限系统，因此不增加公开访问、分享或跨设备匿名写入。

已按上述方案实施。报废入口、全局记录视图、详情快捷入口、冲突选择弹窗和 OpenAPI 均以真实 API 为准；前端不显示内部 `status` 或泛化的手动“用完”动作。隔离冒烟测试覆盖“全量报废 → 从当前库存消失 → 在全局记录找到 → 撤销后恢复库存”。
