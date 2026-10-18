# v2.0.0 发布记录（厨房相册）

状态：**verified**（2026-10-18，用户线上验收"非常好"并确认下架其他功能）。

## 本版内容

产品定位转为厨房相册（用户 2026-10-16/17 批准）：打开即相册，旧模块入口隐藏、`?kitchen` 恢复。范围：

- 后端：上传读 EXIF 原始拍摄时间（仅日期，晚于今天不用），`UploadedAsset.taken_on`；列表返回全库编号 `ordinal` 与 `month_totals`；契约已导出。无 migration、无新依赖。
- 前端：相册外壳（`AlbumApp` + `?kitchen` 旧入口）、记一顿直通相册、时间线月章、日历墙、保存庆祝、PWA manifest 与图标、交互打磨（渐显/错落/数字滚动/悬停，尊重减少动态）。

## 制品

- RELEASE_ID：`2.0.0-20261017T153803Z-2384f9112ef4`
- 部署提交：`2384f9112ef4fab741485910a8ca1126bfbacd76`（= `a8098be`，tag `v2.0.0` 指向它）
- 前端 tgz sha256 `89d4615f…`；后端源码 tgz `3c10b394…`；后端镜像 `7d8e179a…`（image id `6b4e2cb545a4`）；manifest 自身 sha256 `979bd298…`
- 记录目录：服务器 `/data/pantry-nook-back/releases/2.0.0-20261017T153803Z-2384f9112ef4/`（含 DB dump、媒体归档、migration 前后对照）

## 发布前证据（本地）

- 后端 unittest 94 通过；前端 vitest 199 通过；typecheck/lint 干净；契约与后端一致；`check-version.ps1` 2.0.0 一致。
- 逐页编号 API 回归 `journal_ordinal_api_test.py`：隔离库逐页核对一致（39 顿与 61 顿两轮）。
- 真实 Chromium 走查 24 项全过（含弹窗内选图/替换、EXIF 日期、庆祝编号一致、`?kitchen`、manifest）；两轮独立只读审查共 17 项发现全部修复。
- 预检 `[10/10]` 通过（空库 Docker 栈、子路径、鉴权、MIME、SPA、真实 API、OCR 链路、上传落盘、媒体卷持久化）。候选证据 `.review/release-preflight/evidence.json`。
- 预检期间修正两处过时门禁并提交（icon/manifest 子路径断言、惰性分包改名 `App-*`）；预检要求工作区干净，门禁修正随 `chore(release)` 提交入 main。
- 本地隔离评审环境（3051/5221，测试库 `pantry_nook_test_585bef…`）供全程走查，服务在发布后停止。

## 线上核验（2026-10-17/18）

- 公网匿名：首页、API、manifest 全部 401 + `WWW-Authenticate: Basic` ✅
- 服务器环回：`/health` ok（db connected）；7 个真实列表 API 200 + 约定 JSON；未知路由 JSON 404 ✅
- 真实数据：5 篇手记 ordinal=1..5 按日期正确，`month_totals={2026-09:3, 2026-10:2}`；旧照片 `taken_on=null` 回退 entry_date（符合契约）✅
- 前端产物：manifest、icon-192、apple-touch-icon 均在 index.html 引用且随制品部署 ✅
- 容器：backend 2.0.0 镜像 healthy；db 原样；Nginx 配置零改动（前后 SHA 一致）✅
- 登录态深度核验：由用户浏览器完成（真实账号打开并验收"非常好"）；本次未执行上传探针（按数据约束不向生产写测试数据），完整上传链路以本地预检第 9 步 + 预检门禁为准。

## 发布后变更（用户指示"只保留相册"）

- `pantry-ocr` 容器删除（先已 stop + restart=no）；OCR 镜像 1.4.0/1.5.0 删除；`/data/pantry-nook-ocr` 目录删除。
- 旧后端镜像 1.3.0/1.4.0 删除；保留 1.5.0 镜像作为回滚保险（下一个版本发布后再清）。
- `/tmp/pantry-nook-*` 全部制品残留清理；磁盘 74%→64%。
- `?kitchen` 下"拍小票入库"因 OCR 下架会提示服务暂不可用，其余旧功能不受影响。恢复方式：本机 `.review/release-package/` 存有 OCR 镜像 tar.gz，重新 load + up 即可。
- 业务数据（数据库全部表、媒体卷）未做任何删除；`?kitchen` 与未来恢复旧模块完全可行。

## 回滚

`release.sh` 回滚边界与 1.5.0 相同；1.5.0 镜像在机，备份（dump + 媒体归档）在记录目录。
