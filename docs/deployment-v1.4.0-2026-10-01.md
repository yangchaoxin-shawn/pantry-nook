# v1.4.0 发布记录（含 OCR 侧车首装）

2026-10-01 发布并经用户线上验收。进度与基线见 [项目状态](project-status.md)；服务器布局见 [DEPLOY-SERVER](../DEPLOY-SERVER.md)；本机→新机的迁移背景见 [迁移记录](server-migration-2026-10-01.md)。

## 发布事实

| 项 | 值 |
|---|---|
| 版本 / 候选 | `1.4.0`，部署提交 `33accd0fc33ca176f440d6e3e0c47f67fed35076`（1.4.0 代码锚点 `39b55b5` + 发布工具新机适配 `33accd0`） |
| RELEASE_ID | `1.4.0-20261001T051302Z-33accd0fc33c` |
| 用户入口 | `https://system.aihuashen.com/pantry-nook/`（不变） |
| 后端镜像 | `pantry-nook-backend:1.4.0-20261001T051302Z-33accd0fc33c`，`sha256:5c595f15…49682`，linux/amd64 |
| OCR 侧车镜像 | `pantry-nook-ocr:1.4.0-20261001T051302Z-33accd0fc33c`，`sha256:5d5d1766…8ef6a`，linux/amd64 |
| migration | 无新增（1.4.0 零 migration；习惯库由业务表推导），线上 `schema_migrations` 15 项不变 |
| 状态 | `verified`（用户 2026-10-01 线上验收：拍真实小票走完两轮核对入库 + 基础功能抽查） |
| tag | 未打；按约定待用户确认后建 `v1.4.0` annotated tag 绑定 `33accd0` |

## 验证覆盖

- **G2 类生产门**：`preflight-release.ps1` 十步全过（候选 `33accd0`）：测试空库 + Docker 后端、OCR 侧车镜像构建与生产同款部署文件拉起、真实识别链路（合成小票含"农夫山泉"断言）、子路径/Basic Auth/SPA、真实哈希资源 MIME、七个列表接口空库断言、写入门禁、媒体上传/GET/HEAD/Range/伪装视频拒绝、后端重启媒体持久化。证据 `.review/release-preflight/evidence.json`（`ocr_chain_verified: true`）。
- **G3 独立审查**：发布脚本新机适配由独立 agent 只读审查，发现 P1–P6 共 6 项，P1–P5 已在发布前落实（发布记录放回、路径文档、核验脚本默认入口、现场核对、备份目录），P6（历史示例文件残留）发布后清理。
- **G4/G5 服务器与线上**：上传物 8 件 SHA256 逐文件核对一致、脚本零 CR；OCR 首装（compose SHA 一致、容器 healthy、模型 loaded、backend 经 `pantry-ocr:9610` 连通）；`release.sh --check` 通过后 `--apply` 停写切换；公网匿名矩阵 401、`/health` 正常、OpenAPI version 1.4.0、服务器端合成小票识别 HTTP 200（0.92s，2 行正确）。
- **用户验收**：登录新版前端、拍真实小票走完识别→两轮核对→入库、基础功能抽查（"可以了"）。

## OCR 侧车首装证据

- 镜像包 SHA256 `73f9ff41…ab591`（本地/服务器一致）；部署文件 `ocr/deploy/docker-compose.yml` SHA256 `c595182e…9dfc6`，位于 `/data/pantry-nook-ocr/`；容器启动 2026-10-01T05:24:18Z，首启模型加载约 2 分钟内 healthy。
- 资源：启动后全机 used 仅 +0.3G（14G 总量，available 12G+）；`mem_limit: 3g` 硬顶保留。服务器端真实识别 0.92s/张（合成简单样张），与 182 时代（同图 22–25s）对比显著改善。

## 备份与回滚位置（均在 `123.56.128.73`）

- 停写窗口备份：`/data/pantry-nook-back/backups/pantry_nook-1.4.0-20261001T051302Z-33accd0fc33c.dump`、`pantry-media-…tar.gz`（含各自 SHA256 文件与媒体清单）。
- 代码备份：`/data/pantry-nook.bak.<RELEASE_ID>`、`/data/pantry-nook-frontend.bak.<RELEASE_ID>`；Nginx 片段备份 `.bak.<RELEASE_ID>`（本次未改动 Nginx）。
- 旧镜像 `pantry-nook-backend:1.3.0-20260917T161119Z-41c75ac4b0ee`（`sha256:e3c2969a…`）保留在服务器，可按 DEPLOY-SERVER 第 6 节回滚；回滚不回灌数据库。

## 未覆盖与边界

- `verify-deployment.ps1` 工具化核验未跑（需 Basic Auth 明文凭据）；带凭据链路由用户浏览器验收覆盖。
- 公网 OCR 上传由用户以**自己的真实小票**验收覆盖，未使用测试探针（符合数据约束）。
- 前后端全量业务回归未重跑（预检十步 + 用户抽查覆盖；1.4.0 无 migration、API 契约除新增 OCR 端点外不变）。
- OCR 历史持久化、条码→名称学习库仍未实现（已排队，见状态页）。
