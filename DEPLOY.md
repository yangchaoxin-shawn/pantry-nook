# 食隅记 Pantry Nook 部署入口

公司服务器的项目执行口径是 [DEPLOY-SERVER.md](DEPLOY-SERVER.md)。该文档固定真实域名、`/pantry-nook/` 子路径、服务器本机 Nginx、Docker 后端、8016 端口、Basic Auth、数据保护、验证与回滚规则。首次发布采用空生产库；后续不得把“空库”当永久要求。不要从旧的根路径、`/var/www` 或系统 Nginx 示例推导本项目配置。

## 本地开发

本地开发仍按 [README.md](README.md) 启动 PostgreSQL、FastAPI 和 Vite。后端健康地址是 `http://localhost:3000/health`；开发环境由 Vite 代理 `/api`。

## 发布前类生产预检

先准备仅供本机使用、不会提交到 Git 的 `.env.docker.local`：

```env
DB_PASSWORD=<测试专用密码>
FRONTEND_ORIGIN=http://127.0.0.1:18080
```

然后运行：

```powershell
pwsh ./scripts/preflight-release.ps1
```

预检会先运行 `scripts/check-version.ps1`，确保 `VERSION`、前后端与 OpenAPI 版本一致；通过后写入绑定当前 commit 与后端镜像 ID 的本地证据。随后运行 `pwsh ./scripts/package-release.ps1`，生成前端、后端源代码、同一后端镜像和 release manifest。

该脚本使用独立容器名、18014/18080 端口和测试专用空数据库卷，完成生产参数构建，并通过临时 Nginx 验证：

- `/pantry-nook/` 子路径与 SPA 回退；
- 未登录 401 和测试登录后的页面；
- 实际哈希 CSS、JavaScript、字体的状态、正文和 MIME；
- `/pantry-nook/api/` 到后端 `/api/` 的重写；
- 七个真实列表接口（含手记）返回 JSON 空列表；
- 测试图片完整上传、读取、原图一致性、拒绝伪装视频、后端重启持久化及取消后不可读取；
- 后端 `/health`。

脚本默认完成后清理测试专用容器与测试卷，不接触用户评审数据库。

## 健康检查边界

- 容器内：`http://127.0.0.1:3000/health`
- 公司服务器宿主机：`http://127.0.0.1:8016/health`
- 公网 `/pantry-nook/api/health` 在 Basic Auth 之后（匿名 401），不作为匿名探活入口

执行服务器部署、换密和回滚时只使用 [DEPLOY-SERVER.md](DEPLOY-SERVER.md)，并遵守对应部署 skill（服务器 `123.56.128.73` 为 deploy-ahs-server）的文档确认、连接许可、数据库备份、同一镜像、差异检查和 Nginx 语法检查要求。
