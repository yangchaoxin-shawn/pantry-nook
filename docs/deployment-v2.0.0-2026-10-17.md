# v2.0.0 发布记录（厨房相册）

状态：**部署中**（本文档随发布推进更新）。

## 本版内容

产品定位转为厨房相册（用户 2026-10-16/17 批准）：打开即相册，旧模块入口隐藏、`?kitchen` 恢复。范围：

- 后端：上传读 EXIF 原始拍摄时间（仅日期，晚于今天不用），`UploadedAsset.taken_on`；列表返回全库编号 `ordinal` 与 `month_totals`；契约已导出。
- 前端：相册外壳（`AlbumApp` + `?kitchen` 旧入口）、记一顿直通相册、时间线月章、日历墙、保存庆祝、PWA manifest 与图标、交互打磨（渐显/错落/数字滚动/悬停，尊重减少动态）。
- 无数据库 migration；无新依赖（仅使用既有 pillow 读 EXIF）。

## 发布前证据（本地）

- 后端 `unittest discover` 94 通过；前端 vitest 199 通过；typecheck/lint 干净；`export_openapi.py --check` 与归档契约一致；`check-version.ps1` 2.0.0 一致。
- 逐页编号 API 回归 `scripts/journal_ordinal_api_test.py`：隔离库 39 顿 13 页逐页核对一致（后含 61 顿复测）。
- 真实 Chromium 走查（Playwright，390/360/1280 宽，亮暗双主题）24 项全过，含弹窗内再选图/替换、草稿保护、EXIF 日期、庆祝编号一致、`?kitchen`、manifest。
- 两轮独立只读代码审查共 17 项发现全部修复（上传弹窗 inert、未来日期、编号分页、月顿数请求、对比度、读屏、手机栅格、标题断行等）。
- 布局测量：全视口零横向溢出；动画落定无残影。

## 制品与部署

- RELEASE_ID：`2.0.0-<UTC>Z-<sha12>`（打包后回填）
- 流程：`preflight-release.ps1`（本地 Docker 类生产门禁）→ `package-release.ps1` → 服务器 `release.sh --check` → 停写备份 → `--apply` → 公网核验。
- 数据保护：普通升级，不停机删改；数据库与媒体卷原样，历史手记/照片保留。

## 线上核验

（部署后回填：匿名鉴权矩阵、真实哈希资源、API JSON、`/health`、上传链路落盘、manifest 可读。）

## 回滚

上一版制品与备份位置见服务器 `/data/pantry-nook-back/`；`release.sh` 回滚边界与 1.5.0 相同。
