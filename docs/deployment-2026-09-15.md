# Pantry Nook 首次公司服务器发布记录

日期：2026-09-15。线上入口：[https://preview.aihuashen.com/pantry-nook/](https://preview.aihuashen.com/pantry-nook/)。本记录描述首次发布后的实际状态和故障修复，不替代可重复执行手册 [DEPLOY-SERVER.md](../DEPLOY-SERVER.md)。

## 实际架构与数据

- 服务器本机 Nginx 托管 `/usr/local/nginx/html/pantry-nook/`。
- Docker 运行 FastAPI 后端与 PostgreSQL；后端仅绑定宿主机 `127.0.0.1:8014`。
- 页面、静态资源和 `/pantry-nook/api/` 均由该项目的 Basic Auth 保护，其他项目不受影响。
- 单用户鉴权方式、认证文件位置和换密流程记录在 [部署执行文档](../DEPLOY-SERVER.md)；实际用户名和口令保存在忽略 Git 的本地秘密记录中。
- 首次生产数据库为空，没有导入本地评审或演示数据。

## 本次踩坑与修复

1. 首次前端构建没有固定 `/pantry-nook/` 基路径，页面引用了错误的根路径资源。现已用 `frontend/.env.production` 固定 Web 与 API 子路径。
2. Nginx 静态资源没有优先命中实际文件，SPA 回退把 `index.html` 当作 CSS/JavaScript 返回，引发 MIME 错误。现已为 `/pantry-nook/assets/` 设置独立 404 规则。
3. 上传后的 `assets` 目录权限过严，Nginx worker 无法读取文件，进一步触发 SPA 回退。线上已修为目录 755、文件可读；执行手册加入固定权限步骤。
4. API 重写曾把 `/pantry-nook/api/...` 错误转成后端 `/...`，而后端真实路由位于 `/api/...`，导致多个列表 404。现已固定为 `/api/$1`。
5. 曾把猜测的健康检查或接口地址当作验收对象。真实后端健康地址是服务器宿主机 `http://127.0.0.1:8014/health`；公网不提供 `/pantry-nook/api/health`。
6. 页面已能打开后仍有旧字体预加载和移动 Web App meta 警告。无效预加载已移除，并补充标准 meta。

## 已完成的线上核验

- 匿名访问项目入口返回 401；正确账号登录后首页返回 200。
- 当前首页引用的哈希 CSS、JavaScript 和字体均返回实际资源正文及正确 MIME。
- ingredients、dishes、meal-plans、consumptions、inventory-adjustments、daily-battles 六个真实列表接口均返回 JSON 200。
- Docker 后端健康，生产列表为空；页面可以展示正常空状态。

以上结果是 2026-09-15 的发布快照。后续发布必须重新运行类生产预检、线上核验和浏览器检查，不能直接继承本记录的“通过”。

## 从本次开始固定的防复发机制

- `frontend/.env.production` 固定真实部署子路径，favicon 同样跟随 Vite base。
- `scripts/preflight-release.ps1` 使用测试专用空库、Docker 后端和临时 Nginx 完成类生产全链路。
- `scripts/verify-deployment.ps1` 从线上首页提取真实哈希资源和 CSS 引用字体，并验证 Basic Auth challenge、正文、MIME、真实 API 与空库；它只代表公网 HTTP 链路，服务器健康和权限仍单独核对。
- 预检硬性限定测试容器名、18000 段端口和测试数据库卷；原生命令失败立即中止，默认结束后反查容器和卷已经删除。
- 生产构建前显式固定并在结束后恢复 Web/API 基路径环境变量，产物还要检查实际 API 基路径，避免终端残留配置污染构建。
- 发布包记录唯一 RELEASE_ID 和 SHA256；后端、前端与 Nginx 都使用同一 RELEASE_ID 生成唯一备份路径，发布与回滚禁止使用通配符猜测。
- ChatGPT Work / Codex 固定采用主任务整合、独立只读审查、主任务最终验证；部署增加部署前审查和部署后核验。
- 每次发布新建一份发布日期记录，并同步 [项目状态](project-status.md)；部署执行只使用 [DEPLOY-SERVER.md](../DEPLOY-SERVER.md)。

## 当前记录边界

首次发布时没有把服务器备份文件名和发布 Git 提交写入同一份证据记录，不能事后猜测。下一次发布从 G1 候选门开始强制记录提交、构建时间、Nginx 备份、前端备份、后端目录备份和验证输出。
