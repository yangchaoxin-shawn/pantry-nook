# Pantry Nook — ChatGPT 主 Agent 工作交接

> 工作区：`C:\Users\yangchaoxin\Desktop\pantry-nook`
> 当前开发负责人：ChatGPT
> 当前设计输入：WorkBuddy V5
> 设计包版本：`WB-V5-2026-09-09`
> 设计系统版本：`2.0`
> 更新日期：`2026-09-09`

## 本轮最新进展（2026-09-09）

用户已批准按其最终想法执行。当前主页面已收敛为菜单、库存、菜品：每餐记录、备餐食材、菜名复用、做完核对实际用量、整餐确认、撤销和同屏历史已接通。继续工作先看 [当前规格](docs/menu-workflow-proposal.md) 和 [最新交付报告](docs/menu-workflow-delivery.md)。[旧轮交付](docs/delivery-2026-09-09.md) 仅作历史；临期、统计、共享等 [V5 其他能力](docs/v5-product-proposal.md) 仍未批准。测试方法见 [backend/TESTING.md](backend/TESTING.md)。

验证：后端 75 项业务回归、10 项冒烟、45 项菜单闭环断言、4 项契约测试；前端 14 项请求测试及 typecheck/lint/build。浏览器真实确认与撤销、1440/768/390px 亮暗、加载/空库/断开接口恢复已检查。业务库增量迁移前已备份；备份恢复到隔离库后验证原有七张表数据不变、迁移重复执行不变。此轮联调测试数据仅写入隔离库，尚未部署服务器。

## 1. 当前工作模式

ChatGPT 是本项目对用户负责的主 agent / 总负责人。

### 当前测试数据约定（2026-09-10）

当前业务库中的食材、菜品、菜单、搭配和消耗均为测试数据。用户后续直接说“清空数据”时，ChatGPT 应先备份，再按完整测试业务数据清理流程执行；不要按菜名、食材名或历史内容猜测哪些数据需要保留。第一版发布使用空数据库完成 migration，不迁移本地测试数据，也不自动导入示例数据；待用户完成全量验收并明确进入发布阶段后，再做发布前的数据处理和部署核验。

### 当前开发阶段边界（2026-09-10）

当前只做本地真实 API 联调、数据库业务规则、自动化测试和浏览器验收。Docker、Nginx 和服务器部署不参与当前功能开发或验收；待本地全部模块稳定、用户明确进入发布阶段后，再以当时的代码与空生产数据库重新设计、构建和验证部署链路。

ChatGPT 负责整个项目：

- 产品需求理解和技术方案
- React 19 + TypeScript + Vite 前端
- Python 3.13 + FastAPI + asyncpg 后端
- PostgreSQL 数据库和迁移
- OpenAPI API 契约
- 前后端联调
- 视觉实现和持续视觉打磨
- 自动化测试和浏览器测试
- Docker、Nginx 和部署配置
- 项目文档和交付报告

WorkBuddy 只提供视觉设计、交互原型、画布和设计参考。WorkBuddy 不负责当前项目的后续 coding。

## 2. ChatGPT 可以使用 subagent

ChatGPT 可以按需使用自己的：

- subagent
- 并行任务
- 代码审查 agent
- 测试 agent
- 研究 agent
- 视觉检查 agent

这些 agent 是 ChatGPT 的内部执行机制，不是项目负责人，也不需要用户单独管理。ChatGPT 必须负责：

- 给 subagent 正确的上下文和边界；
- 汇总、验证和合并 subagent 结果；
- 对最终代码、数据库、契约、视觉和测试结果负责；
- 不把未经验证的 subagent 结论直接当作完成结果。

不要把“ChatGPT 可以使用 subagent”误解成“项目交给多个外部 agent 分工”。当前仍然只有一个主负责人：ChatGPT。

## 3. 什么时候需要真正交接

只有用户明确说以下类似内容时，才发生主负责人切换：

- “把项目交给另一个 agent 继续开发”
- “让新的 ChatGPT 会话接手”
- “以后由某个 agent 负责”
- “停止当前 ChatGPT，让另一个 agent 继续”

如果用户没有明确要求切换，ChatGPT 应继续在本工作区完成任务，不要主动要求外部交接。

发生主负责人切换时，新负责人必须先阅读：

1. `CHATGPT_HANDOFF.md`
2. `CLAUDE.md`
3. `docs/PRD.md`
4. `docs/frontend-design-handoff.md`
5. `design/handoff-manifest.json`
6. `design/design-system.md`
7. `contracts/openapi.yaml`
8. 当前 `frontend/` 和 `backend/`

## 4. 设计资料

WorkBuddy V5 资料已归档到：

```text
design/
├── pantry-nook-prototype.html
├── design-system.md
├── 今日三餐.png
├── 共享反馈墙.png
├── ardot-canvas-link.txt
└── handoff-manifest.json
```

Ardot 画布：

```text
fileId: 723725203427240
https://ardot.tencent.com/file/723725203427240?from=workbuddy
```

设计资料是视觉输入，不自动等于产品需求或后端契约。

原型里的数字、菜名、反馈和统计是演示数据，不能直接写入真实业务。

## 5. 当前项目事实来源

按优先级阅读：

1. `docs/PRD.md`：产品业务规则和功能边界；
2. `CLAUDE.md`：项目技术约束和工作规则；
3. `contracts/openapi.yaml`：当前 API 路径和契约；
4. `backend/app/`：当前后端真实实现；
5. `frontend/`：当前前端真实实现；
6. `design/`：WorkBuddy 视觉和交互输入；
7. `README.md`、`DEPLOY.md`：运行和部署说明。

## 6. 当前技术栈和启动方式

后端：

```powershell
cd C:\Users\yangchaoxin\Desktop\pantry-nook\backend
uv sync
uv run uvicorn app.main:app --port 3000 --reload
```

前端：

```powershell
cd C:\Users\yangchaoxin\Desktop\pantry-nook\frontend
npm install
npm run dev
```

验证：

```powershell
# 后端
cd backend
uv run python -m compileall app scripts -q
uv run python scripts/smoke_test.py 3000

# 前端
cd frontend
npm run typecheck
npm run lint
npm run build
```

浏览器至少验证：

- 桌面端约 1440px；
- 移动端约 390px；
- 亮色/暗色主题；
- 真实 API 数据；
- 加载、空数据、错误、正常状态；
- 控制台没有错误；
- 没有 React runtime error。

## 7. 当前后端能力

已有接口：

```text
/api/ingredients
/api/dishes
/api/meal-plans
/api/daily-battles
/api/consumptions
/health
```

当前核心规则：

1. 存在未确认今日作战时不能直接改库存数量；
2. 确认操作必须在一个数据库事务中写消耗并调库存；
3. 搭配方案是模板，创建今日作战时复制菜品；
4. 数量保留原文；
5. 撤销确认必须可靠恢复库存；
6. 所有 SQL 参数化。

## 8. 设计缺口处理

当前设计中以下能力可能还没有后端支持：

- 早餐/午餐/晚餐字段；
- 三餐切换；
- 临期日期和临期提醒；
- 库存周转统计；
- 消耗统计；
- 废弃率统计；
- 共享反馈墙；
- 反馈提交、已读、采纳；
- 无登录公开共享链接。

ChatGPT 可以负责实现这些能力，但在改变产品语义、数据库模型、共享数据模型或公开访问规则之前，必须先向用户说明：

- 产品含义；
- 数据模型；
- API 设计；
- 状态流转；
- 安全和隐私影响；
- 数据迁移影响；
- 前后端改动范围。

用户确认后，由 ChatGPT 自己完成全栈实现。ChatGPT 可以自行决定是否使用内部 subagent，但不需要更换主负责人或进行外部 agent 交接。

## 9. 可修改范围

ChatGPT 可以修改整个项目工作区，包括：

- frontend/
- backend/
- contracts/
- tests/
- scripts/
- docs/
- design/ 中的实现辅助文件或后续设计整理文件
- README.md
- CLAUDE.md
- CHATGPT_HANDOFF.md
- DEPLOY.md
- docker-compose.yml
- nginx.conf.example

WorkBuddy 原始视觉文件默认作为参考保存，但如果用户后续要求 ChatGPT 继续整理、修改或替换视觉资料，ChatGPT 也可以处理。

## 10. 交付报告格式

完成任务后不要只回复“完成”。至少返回：

```text
## 任务摘要
...

## 修改文件
- ...

## 全栈实现
- 前端：...
- 后端：...
- 数据库：...
- API 契约：...
- 视觉打磨：...
- 部署/文档：...

## 设计对齐
- 使用的 WorkBuddy 设计版本：...
- 已实现的视觉页面：...
- 尚未实现的设计内容：...

## 验证结果
- 后端启动：pass/fail
- 后端测试：pass/fail
- 数据库迁移：pass/fail
- API 联调：pass/fail
- typecheck：pass/fail
- lint：pass/fail
- build：pass/fail
- 桌面浏览器：pass/fail
- 移动浏览器：pass/fail
- 控制台错误：none / ...
- React runtime error：none / ...

## 未完成和待确认
- ...

## 下一步建议
- ...
```
