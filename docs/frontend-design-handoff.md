# 食隅记 Pantry Nook 设计交付与 ChatGPT 单 Agent 全栈开发说明

> 当前用途（2026-09-11）：原始视觉交付参考；下文中的旧范围、读取顺序和验证要求不作为当前协作约定。业务看 [PRD](PRD.md)，开发入口看 [AGENTS.md](../AGENTS.md)，进度看 [项目状态](project-status.md)。

> 设计包：WorkBuddy V5 三餐与共享反馈版
> 交付版本：`WB-V5-2026-09-09`
> 设计规范版本：`2.0`
> 整理日期：`2026-09-09`
> 当前阶段：单一 ChatGPT Agent 全权开发。WorkBuddy 的设计文件只是视觉输入，不再承担独立编码、前后端分工或交接流程。
> ChatGPT 负责后续全部 coding、视觉打磨、React+TypeScript、Python+FastAPI、PostgreSQL、API 契约、测试、联调、部署和文档。
> 之前关于多 Agent 分工、交接编排和多人协作的调研方案暂不启用；未来如用户提供新的绘画/视觉方案，再重新设计协作模式。

## 1. 这份文档解决什么问题

2026-09-09 补充：用户已批准简化后的 [菜单闭环规格](menu-workflow-proposal.md)。颜色、表面、圆角仍参考 V5；页面结构以用户的新需求为准，采用菜单/库存/菜品三入口与同屏历史，不照搬原稿的统计侧栏、单菜确认或反馈墙。原设计包保持原版归档，未改写版本。

ChatGPT 接到本项目后，应先阅读根目录 `CHATGPT_HANDOFF.md`，它是当前单 Agent 模式的总工作交接入口；本文件是设计资料和设计差距的补充说明。

不要通过复制聊天记录传递上下文。以下内容才是本次交接的事实来源：

- 产品业务规则：`docs/PRD.md`
- 当前 API 路径与现状：`contracts/openapi.yaml`、`backend/app/`
- 视觉设计规范：`design/design-system.md`
- 视觉唯一事实源：`design/今日三餐.png`、`design/共享反馈墙.png`
- 行为参考：`design/pantry-nook-prototype.html`
- 画布走查入口：`design/ardot-canvas-link.txt`

## 2. WorkBuddy 原始交付与项目归档

### 2.1 原始工作区

```text
C:\Users\yangchaoxin\WorkBuddy\2026-09-07-00-58-51
```

### 2.2 已复制到项目的文件

```text
design/
├── pantry-nook-prototype.html   # 可交互原型：行为参考与设计令牌来源
├── design-system.md             # 设计系统规范 v2.0
├── 今日三餐.png                  # 今日三餐视觉基准，2x 高清
├── 共享反馈墙.png                # 共享反馈墙视觉基准，2x 高清
├── ardot-canvas-link.txt         # Ardot 画布链接与 fileId
└── handoff-manifest.json         # 本设计包的机器可读清单
```

Ardot 画布入口来自原始交付文件：

```text
fileId: 723725203427240
https://ardot.tencent.com/file/723725203427240?from=workbuddy
```

### 2.3 文件用途和优先级

| 优先级 | 文件 | 用途 | 注意事项 |
|---|---|---|---|
| 1 | `今日三餐.png`、`共享反馈墙.png` | 视觉像素基准 | 只代表已交付的两屏，不代表全部页面 |
| 2 | `design-system.md` | 颜色、字体、间距、组件和页面规范 | 是视觉实施约束，不是业务需求 |
| 3 | `pantry-nook-prototype.html` | 可交互行为参考 | 原型中的数据是演示数据，不得直接写入数据库或当作 API 返回值 |
| 4 | Ardot 画布 | 走查和后续像素修改 | 后续若画布更新，需重新归档并升设计包版本 |
| 5 | `docs/PRD.md` | 业务逻辑和功能边界 | 视觉稿与 PRD 冲突时，ChatGPT 不得自行改变产品含义；应向用户确认后再修改全栈实现 |

## 3. WorkBuddy V5 的设计结论

### 3.1 设计定位

目标是从单纯的库存 CRUD 页面升级为 1-2 人家庭的厨房生活闭环：

```text
记录食材 → 今日菜单 → 确认三餐 → 消耗归档 → 共享反馈
```

整体气质：

```text
温暖、居家、生活化、清晰高效
```

三条视觉硬规则：

1. 全局使用单一强调色：陶土 Terracotta；功能色只承担状态语义。
2. 胶囊形是行动的主要语法；按钮按压统一使用 `scale(0.95)`。
3. 层级主要依靠字重和灰度，不使用 500 中间字重；标题使用负字距。

### 3.2 设计 token 摘要

完整值以 `design/design-system.md` 和原型顶部 CSS 变量为准。核心亮色值如下：

```css
--primary: #B3541E;
--primary-strong: #96430F;
--primary-deep: #7A360B;
--primary-300: #D68A52;
--primary-100: #F3D7BF;
--primary-50: #FBEEE3;

--canvas: #FAF6EF;
--surface: #FFFFFF;
--surface-warm: #F4EDE1;
--hairline: #E7DCCB;
--ink: #2E2620;
--ink-soft: #5B4F45;
--ink-muted: #84766A;
--ink-faint: #B9AC9E;

--success: #4F7A45;
--warning: #C77F1A;
--danger: #B03A2E;
--info: #4A6FA5;
```

尺寸规则：

- 工具按钮圆角：`8px`
- 输入框/列表行圆角：`12px`
- 卡片圆角：`18px` 至 `20px`
- 主按钮/徽标圆角：`9999px`
- 间距单元：`4 / 8 / 12 / 16 / 24 / 32 / 48 / 80px`
- 卡片内边距：`24px`
- 页面左右留白：`32px`
- 快速动效：`150ms`
- 基准动效：`300ms`
- 缓动：`cubic-bezier(.4,0,.2,1)`

字体栈：

```text
SF Pro Text / PingFang SC / Microsoft YaHei / system-ui
```

字体权重约定：正文 `400`，强调 `600/700`，不主动使用 `500`。

### 3.3 今日三餐屏

桌面基准尺寸：`1440×900`。

页面结构：

- 顶部导航：品牌、今日、库存、菜品、反馈墙、提醒、写反馈。
- 页面标题：`今天吃什么?`
- 日期/进度副标题：显示三餐筹备状态。
- 主卡片：今日菜单。
- 三餐切换：早餐、午餐、晚餐及各自菜品数。
- 菜品状态：已确认、待确认。
- 右侧统计：库存总数、临期提醒、本周消耗。
- 右侧提醒：优先吃掉的临期食材。
- 右侧洞察：平均消耗、库存周转天数、废弃率。

原型中的“28、3、5.2 样、4.1 天、8%”以及“番茄牛腩、蒜蓉西兰花”等均是视觉演示数据，不是当前数据库中的固定数据。

### 3.4 共享反馈墙屏

桌面基准尺寸：`1440×900`。

页面结构：

- 共享状态标识：`共享部署 · 无需登录，打开即见`。
- 写反馈入口：头像、文本输入、感受快捷选择。
- 感受标签：很喜欢、有点困惑、想吐槽。
- 反馈卡：早餐、午餐、晚餐反馈；未读/已读；采纳为待办。
- 底部说明：通过一个共享链接即可写入与查看。
- 移动端使用底部标签栏和反馈输入面板。

这部分涉及新的产品身份和数据共享模型，当前不能直接视为已批准的后端业务规则，见第 5 节。

## 4. 当前工程基线

### 4.1 技术栈

```text
frontend/  React 19 + TypeScript + Vite
backend/   Python 3.13 + FastAPI + asyncpg
数据库      PostgreSQL
依赖管理    frontend: npm；backend: uv + venv
```

前端入口：

```text
frontend/src/App.tsx
frontend/src/main.tsx
frontend/vite.config.ts
```

后端入口：

```text
backend/app/main.py
```

本地启动：

```powershell
# 终端 1
cd backend
uv run uvicorn app.main:app --port 3000 --reload

# 终端 2
cd frontend
npm run dev
```

### 4.2 当前已有 API 能力

当前后端已有资源：

```text
/api/ingredients
/api/dishes
/api/meal-plans
/api/daily-battles
/api/consumptions
/health
```

已有能力包括：

- 食材列表、创建、修改、消费、丢弃、查看消耗记录。
- 菜品列表、创建、修改、软删除、查看关联搭配方案。
- 搭配方案创建、修改、删除和菜品复制。
- 今日作战创建、修改、取消、确认、撤销确认和消耗记录查询。
- 消耗历史列表和详情。

统一响应约定：

```json
{ "data": {} }
{ "data": [], "meta": { "total": 0, "limit": 50, "offset": 0 } }
{ "error": { "code": "...", "message": "..." } }
```

当前核心业务规则不能被前端改变：

1. 存在未确认的今日作战时，不能直接修改库存数量。
2. 确认操作必须在同一数据库事务中写消耗记录并调整库存。
3. 创建今日作战时复制搭配方案中的菜品，不能共享模板数据。
4. 数量保留用户原文，不擅自换算单位。
5. 撤销确认时必须能可靠地按原消耗恢复库存。

### 4.3 当前契约的限制

`contracts/openapi.yaml` 已有全部 API 路径，但当前部分响应和请求体是通过 `Request` 手动解析与校验，OpenAPI 中对应的 body schema 仍可能是空 schema。不要仅凭 `openapi-typescript` 生成的空类型开发新的业务字段。

开发前应同时阅读：

- `contracts/openapi.yaml`
- 对应的 `backend/app/routes/*.py`
- `backend/app/validation.py`
- `docs/PRD.md`

如果页面或业务需要契约中不存在的字段，ChatGPT 不得静默编造字段或改变既有语义；应先向用户说明产品、数据模型、API 和兼容影响。用户确认后，由 ChatGPT 自己同步完成后端、数据库、契约、前端和测试改动。

## 5. 设计与当前产品/后端的差距

以下内容是后续开发前必须显式处理的差距。

| V5 设计内容 | 当前是否已有支持 | 当前事实 | 后续处理 |
|---|---:|---|---|
| 库存列表视觉升级 | 有 | 已有 `/api/ingredients` | 可直接改造前端，使用真实数据 |
| 菜品库视觉升级 | 有 | 已有 `/api/dishes` | 可直接改造前端，使用真实数据 |
| 搭配方案视觉升级 | 有 | 已有 `/api/meal-plans` | 可直接改造前端，注意 `dishes` 是数组 |
| 今日作战视觉升级 | 部分 | 已有 `/api/daily-battles`，但没有三餐字段 | 先明确三餐模型，再决定接口变更 |
| 早餐/午餐/晚餐切换 | 无 | 数据库 `daily_battles` 当前没有 `meal_slot` 字段 | 需要 PRD、schema、API 一起变更 |
| 今日首页统计卡 | 无 | 当前没有库存统计、临期统计、周转洞察 API | 不得使用原型固定数字冒充真实数据；可先显示已有真实信息或待开发状态 |
| 临期提醒 | 无 | 当前食材模型没有明确的过期日期字段 | 需要先定义保质期字段和判定规则 |
| 共享反馈墙 | 无 | 当前没有 feedback 表、路由、响应模型 | 需要产品确认共享写入、删除、已读、采纳规则后再开发 |
| 无登录/无权限共享链接 | 未批准 | WorkBuddy 设计文档提出了该模型，但当前 PRD 第一版明确暂不做多人账号，二者不是同一个决定 | 必须由产品负责人确认，并评估公开写入风险 |
| 暗色主题 | 前端可做 | 不依赖后端 | 可直接实现，但以 token 为准 |
| 反馈 toast、chip、下拉等交互 | 原型有 | 属前端本地交互 | 可直接按原型实现 |

### 5.1 不允许的处理方式

- 不要把原型中的演示统计值硬编码进真实页面。
- 不要用前端 localStorage 伪装共享反馈墙的跨设备持久化。
- 不要为了显示早餐/午餐/晚餐而擅自把现有作战记录按时间或名称猜分类。
- 不要为反馈墙临时添加一个未经过批准的 `/api/feedback` 接口。
- 不要通过修改 `contracts/openapi.yaml` 来掩盖后端没有实现接口的事实；如果经过用户确认要新增能力，必须同时实现后端、数据库、契约、前端和测试。
- 不要把“视觉原型可以点击”当作“真实功能已经完成”。

## 6. ChatGPT 的单 Agent 全栈工作方式

ChatGPT 接到本项目后，是对用户负责的主 coding agent 和总负责人，负责从需求理解、技术方案、编码、视觉实现、持续打磨、测试、联调到最终交付。

ChatGPT 可以按需使用自己内部的 subagent、并行任务或审查 agent。这些 subagent 是 ChatGPT 的内部执行手段，不改变 ChatGPT 对整体结果的责任，也不需要用户单独管理它们。

只有用户明确要求把工作交给另一个外部 agent 或新的主会话时，才需要执行项目交接；交接方必须先阅读本文件和 `CHATGPT_HANDOFF.md`。

1. 先读取本文件、`design/design-system.md`、两张 PNG、`design/pantry-nook-prototype.html`、`design/handoff-manifest.json`、`docs/PRD.md`、`contracts/openapi.yaml` 和当前代码。
2. 先启动当前应用，查看现有页面、真实 API 数据和数据库状态，再开始修改。
3. 作为本项目唯一的全栈实施 agent，负责 `frontend/`、`backend/`、`contracts/`、数据库迁移、测试、部署配置和相关文档。
4. 可以根据已确认的产品需求扩展 FastAPI、PostgreSQL schema、OpenAPI 契约、React+TypeScript 页面和联调测试。
5. 负责把 WorkBuddy 的视觉基准真正落地到 React 页面，并承担后续全部视觉打磨，包括布局、响应式、交互、动效、可访问性和视觉回归；不需要等待 WorkBuddy 或其他 agent 继续实现。
6. 不修改 `design/` 中的视觉原始交付物或 `docs/PRD.md` 的产品含义；如果设计与 PRD 或现有业务规则冲突，先向用户说明并请求确认。
7. 发现 V5 设计需要新的后端字段或能力时，不得把实现责任转移给其他 agent；应先向用户提交一份变更说明，确认后由你自己完成后端、数据库、契约、前端和测试改动。
8. 用真实 API 和真实数据库数据驱动页面；没有批准后端支持的统计内容不能伪造。
9. 保留加载态、空态、错误态和正常数据态。
10. 完成后必须运行后端测试/冒烟测试、`npm run typecheck`、`npm run lint`、`npm run build`，并用浏览器检查桌面和移动端。
11. 交付时返回完整的修改文件、数据库/契约变更、验证证据、未完成项和需要用户决策的问题。

## 7.1 推荐的单 Agent 开发顺序

ChatGPT 不要一开始只复制原型 HTML，也不要同时铺开所有页面。建议按以下闭环推进：

1. **基线确认**：启动当前 FastAPI 和 React，确认当前数据库状态；运行现有后端冒烟测试和前端检查。
2. **设计系统落地**：先把 WorkBuddy 的 token、字体、卡片、胶囊按钮、徽标、响应式断点和亮/暗主题整理为 React 可复用样式。
3. **已有能力改造**：用真实 API 改造库存、菜品、搭配方案、今日作战、消耗历史；先完成桌面和移动端的加载/空/错/正常状态。
4. **今日三餐建模**：向用户确认早餐/午餐/晚餐与现有 `daily_battles` 的关系，再由 ChatGPT 同步修改 PRD 相关决策、schema、FastAPI、OpenAPI、前端和测试。
5. **首页洞察**：明确临期、库存统计、消耗统计和周转率的计算口径后，再实现统计卡；所有数字来自 API，不使用视觉稿固定数字。
6. **共享反馈墙**：先确认是否真的采用无登录公开链接、谁可以写/删/标记已读/采纳，以及数据保存周期和防滥用规则；确认后再实现完整闭环。
7. **视觉打磨**：每完成一条真实链路，用桌面截图、390px 移动截图、亮暗主题和浏览器控制台检查与视觉基准对比。
8. **最终验收**：在组合后的完整前后端上运行测试、类型检查、构建、真实 API 流程和浏览器验收，再输出交付报告。

```text
你现在要在
C:\Users\yangchaoxin\Desktop\pantry-nook
中继续开发“食隅记 Pantry Nook”的全栈功能。你是本项目唯一的实施 agent，负责 React+TypeScript 前端、Python+FastAPI 后端、PostgreSQL、API 契约、测试、部署配置和联调。

请先阅读：
1. docs/frontend-design-handoff.md
2. design/design-system.md
3. design/今日三餐.png
4. design/共享反馈墙.png
5. design/pantry-nook-prototype.html
6. docs/PRD.md
7. contracts/openapi.yaml
8. frontend/src/ 当前代码

项目技术栈：
- React 19 + TypeScript + Vite
- Python 3.13 + FastAPI + asyncpg
- PostgreSQL

本次视觉基准：
- WorkBuddy V5 三餐与共享反馈版
- 设计包版本 WB-V5-2026-09-09
- 设计规范版本 2.0
- Ardot fileId 723725203427240
- 视觉基准是 design/今日三餐.png 和 design/共享反馈墙.png

你的主要任务：
- 在整个项目中完成 WorkBuddy V5 设计对应的全栈实现。
- 先把真实 API 已支持的库存、菜品、搭配方案、今日作战、消耗历史页面改造成 V5 视觉语言。
- 对于早餐/午餐/晚餐、共享反馈墙、临期提醒、统计洞察等当前不存在的能力，先向用户说明产品和数据模型影响；用户确认后，由你自己同步修改 PRD 相关实现、数据库、FastAPI、OpenAPI、React+TypeScript 和测试。
- 抽取并使用 design-system.md 和原型中的 CSS token、字体、间距、圆角、按钮、徽标、卡片规则。

重要边界：
- 可以修改 frontend/、backend/、contracts/、数据库迁移/初始化脚本、测试、Docker 和项目文档，但每项跨层变更必须说明原因和影响。
- 如果页面需要 meal_slot、过期日期、反馈墙、统计洞察等当前不存在的字段或接口，不要静默猜测；先向用户说明建议的数据模型、API、状态和兼容影响，得到确认后再由你完整实现。
- 不要把原型中的演示数据（例如 28、3、5.2、4.1、8% 和示例菜名）当作真实数据。
- 共享反馈墙的“无登录、公开链接、任何人可写”是设计提案；实现前必须确认公开写入和数据持久化规则。
- 不要用 localStorage 伪装跨设备共享持久化。
- 保持成功响应 `{ data, meta? }` 和错误响应 `{ error: { code, message } }`，除非你在确认后的契约变更中同步更新所有消费者。
- 所有页面必须处理加载态、空态、错误态和正常态。
- 使用 TypeScript，不能用 any 绕过类型检查。
- API 请求集中封装，不能在组件中散落硬编码 URL。

开发和验证：
```powershell
# 后端终端
cd C:\Users\yangchaoxin\Desktop\pantry-nook\backend
uv run uvicorn app.main:app --port 3000

# 前端终端
cd C:\Users\yangchaoxin\Desktop\pantry-nook\frontend
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

浏览器验收至少包括：
- 桌面宽度约 1440px
- 移动宽度约 390px
- 亮色/暗色主题
- 五个现有页面或对应导航
- 真实 FastAPI 数据加载
- 空数据和错误状态
- 浏览器控制台无错误
- 不出现 React runtime error

完成后请返回：
1. 修改/新增/删除文件清单
2. 实际实现了哪些 V5 视觉内容
3. 使用了哪些现有 API
4. 哪些设计内容因后端能力不足暂未实现
5. 后端/产品变更请求（如有）
6. `npm run typecheck`、`npm run lint`、`npm run build` 结果
7. 浏览器桌面/移动端验证结果和控制台错误
不要只回复“完成”。
```

## 8. ChatGPT 交付回收格式

ChatGPT 返回的交付信息应至少包含：

```text
任务 ID：PN-FE-V5-001
设计包版本：WB-V5-2026-09-09
设计规范版本：2.0
工作区：C:\Users\yangchaoxin\Desktop\pantry-nook

修改文件：
- ...

新增文件：
- ...

删除文件：
- ...

已对接 API：
- ...

暂未实现：
- ...

后端/产品变更请求：
- ...

验证：
- typecheck: pass/fail
- lint: pass/fail
- build: pass/fail
- desktop browser: pass/fail
- mobile browser: pass/fail
- console errors: none / ...
```

“ChatGPT 说已完成”只代表实施方声明，不代表验收通过。交付后，ChatGPT 必须提供机器检查、真实联调和浏览器验收证据，由用户进行最终确认；如发现问题，仍由 ChatGPT 在同一工作区继续修复。

## 9. 后续设计更新规则

WorkBuddy 后续再次调整设计时，不要覆盖当前文件后直接交给 ChatGPT。按下面流程处理：

1. 新文件放入新的设计包目录或使用明确的新版本文件名。
2. 更新 `design/design-system.md` 或新增版本规范，并写明变更点。
3. 更新 `design/handoff-manifest.json` 的 `designPackageVersion`、来源和文件清单。
4. 更新本文档的第 2、3、5 节及复制给 ChatGPT 的 Prompt。
5. 对比旧 PNG 和新 PNG，明确哪些页面、组件、token、行为发生变化。
6. 只有批准的设计版本才能成为新的视觉基准。

当前 `design/` 中的 V5 设计可作为当前候选基准，但“后续会再次调整”意味着 ChatGPT 必须以版本号识别设计，不得把它视为永久不变的规范。
