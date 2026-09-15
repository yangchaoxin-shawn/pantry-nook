# Pantry Nook v1.1.0 正式发布记录

发布日期：2026-09-15。

## 发布身份

- 版本与标签：`1.1.0` / `v1.1.0`。
- 部署 commit：`c7c189011bfc0faf8332118dd7fcfdf79c796bdb`。
- Release ID：`1.1.0-20260915T091813Z-c7c189011bfc`。
- 用户入口：[https://preview.aihuashen.com/pantry-nook/](https://preview.aihuashen.com/pantry-nook/)。
- 服务器发布记录：`/data/pantry-nook-shared/releases/1.1.0-20260915T091813Z-c7c189011bfc/deployed-release.txt`，状态为 `verified`。

## 本次变化

- 新增“汤料”库存大类，顺序为：碳水、蔬菜、蛋白质、水果、汤料、其他。
- 接入库存录入、编辑、分类筛选、分组图标、餐安排食材筛选和推荐单位。
- OpenAPI、前端生成类型和数据库分类约束同步更新。
- 新增 `012_soup_ingredient_category.sql`，只扩展分类约束，不修改既有业务行。

本次没有导入第二批家庭真实数据，没有执行 seed、reset、truncate、drop、`down -v` 或删除生产卷，也没有重建 Basic Auth 或修改 Nginx 项目块。

## 发布前证据

- 本地类生产预检绑定上述 commit 和 `1.1.0`，使用独立空数据库、Docker 后端和临时 Nginx 验证成功并完成资源清理。
- 后端 12 项单元测试与 OpenAPI 漂移检查通过；前端 111 项测试、类型检查、lint 和生产构建通过。
- 旧版数据库升级演练覆盖 migration `11 → 12`、既有五类库存完整行不变、新分类可写、未知分类被数据库拒绝及重复迁移幂等。
- 本地与服务器上的前端包、后端源码包和 Linux 后端镜像 SHA256 均与 Manifest 一致；服务器使用同一镜像 ID `sha256:e9719ed1f0de498c5b7e2cace0b5ceffd180c21cb475f20a84940a9359653b81`，未重新构建。

## 数据备份与迁移

- 迁移前备份：`/data/pantry-nook-shared/backups/pantry_nook-1.1.0-20260915T091813Z-c7c189011bfc.dump`。
- 备份 SHA256：`b4be566106b071c063680761595da230605c5beb4d950b4a0353aef897f10371`。
- `pg_restore --list` 已验证备份可读取。
- migration 从 11 条增加到 12 条，新增项只有 `012_soup_ingredient_category.sql`，其校验值与发布 Manifest 一致。
- 六张业务表发布前后数量和完整行指纹一致：库存 14、菜品 16、搭配 0、消耗 0、库存处理 0、餐安排 0。

## 线上核验

- 未认证的首页、静态资源和 API 在返回项目内容前即由 Basic Auth 拦截。
- 登录后首页、SPA 子路由、真实哈希 CSS、JavaScript 和字体均返回正确正文与 MIME；不存在资源返回 404。
- 六个真实列表 API 返回 JSON 200；不存在 API 返回 JSON 404 与 `ROUTE_NOT_FOUND`。
- 后端与 PostgreSQL 容器健康，宿主机 `/health` 正常，OpenAPI 版本为 `1.1.0`。
- 数据库分类约束包含“汤料”，线上只读“汤料”筛选请求正常返回空列表。
- Nginx 配置与发布前备份逐字节一致，`nginx -t`、Linux 路径权限、鉴权文件读取和后端日志检查通过。
- Playwright 在生产页面以 1280×900 和 390×844 两个尺寸完成只读核验：库存汤料空状态、餐安排七分类布局、控制台和网络请求均正常。
- 独立 Agent 对 Manifest、备份、数据库、容器、Nginx、公网链路和页面证据完成第二次只读审查。

## 精确回滚输入

- 后端备份：`/data/pantry-nook.bak.1.1.0-20260915T091813Z-c7c189011bfc`。
- 前端备份：`/usr/local/nginx/html/pantry-nook.bak.1.1.0-20260915T091813Z-c7c189011bfc`。
- Nginx 备份：`/usr/local/nginx/cert.d/preview.conf.bak.1.1.0-20260915T091813Z-c7c189011bfc`。
- 数据库备份与服务器发布记录使用本页前述精确路径。

普通代码回滚保留当前生产数据库和数据卷；数据库 dump 只作为灾难恢复输入。若需数据库恢复，必须另开已授权流程，先恢复到新数据库或新卷核验，不能对当前生产库直接执行覆盖式恢复。
