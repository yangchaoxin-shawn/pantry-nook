# 第一版发布基础设施审计（2026-09-10）

## 本轮目标

核对第一版未来发布是否能从空数据库安全启动，不带入当前本地测试数据。本轮只修改部署配置、开发数据清理脚本和说明，未启动容器、未部署服务器、未处理任何业务数据。

## 已确认的启动链路

1. 首次 PostgreSQL 容器启动时，执行 `backend/app/db/schema.sql` 建立当前完整表结构。
2. 后端容器由 `scripts/start_server.py` 启动；当前 schema 快照首次初始化时会先登记其已包含的 migration，再在接受请求前校验版本化 migration 与内容摘要。
3. 已有数据库不依赖重新挂载 schema 文件，而是使用 migration 升级；migration 内容变更会被摘要校验拒绝。
4. 前端保持静态构建，由服务器 Nginx 托管，并把 `/api/` 与 `/health` 转发给本机后端。

## 本轮修正

- `docker-compose.yml` 的 `DB_PASSWORD` 和 `FRONTEND_ORIGIN` 改为必填变量。遗漏 `.env` 或保留空值时，Compose 在启动前直接失败。
- 根目录新增 `.env.example`，只提供生产部署变量的占位结构，不包含任何本机配置或密码。
- `backend/scripts/reset_data.py` 显式覆盖当前全部业务测试表：库存调整、消耗、备餐耗材、菜单、搭配、库存和菜品；保留 `schema_migrations`，避免测试清理后重复执行 migration。
- 清理脚本移除 `CASCADE`。以后若新增业务表却未加入清单，命令会失败而不是静默留下残余数据。
- 空库启动修正为：完整 `schema.sql` 通过明确的当前结构检查后才登记已有 migration；旧库或不完整库不登记，仍按历史 migration 正常升级。
- `DEPLOY.md` 明确第一版必须使用新建空数据库卷，不导入本地测试数据，不自动运行示例数据脚本。

## 发布前仍需执行的验证

以下操作只应在用户完成全量验收并明确进入发布阶段后执行：

1. 在目标服务器创建新的空数据库卷，并从根目录 `.env.example` 生成真实 `.env`。
2. 构建并启动 Compose 容器，验证 `/health` 与 migration 记录。
3. 构建前端，执行 `nginx -t`，验证 SPA fallback、`/api/`、`/health`。
4. 在目标域名完成 HTTPS、桌面/平板/手机访问及访问控制核验。
5. 做一次真实备份恢复演练。

## 本轮已完成验证

- 用不含真实凭据的审计变量通过 `docker compose config --quiet`。
- 后端 `python -m compileall app scripts -q` 通过。
- 从全新独立数据库载入当前 `schema.sql`，再按容器启动路径登记并校验 migration；临时 API 的 `/health` 返回数据库已连接。
- 在该独立数据库运行核心后端冒烟测试，18/18 通过。

## 不在本轮做的事

- 不清空当前本地测试数据。
- 不启动或发布 Docker/Nginx。
- 不自动导入示例数据。
