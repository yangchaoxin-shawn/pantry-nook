# 服务器普通升级脚本

这是 Pantry Nook 自用的发布工具，适用于已经有 `verified` v2 发布记录、固定数据库卷和媒体卷的兼容升级。当前发布状态只看 [项目状态](../../docs/project-status.md)，完整操作顺序见 [服务器执行文档](../../DEPLOY-SERVER.md)。

## 默认与边界

- 无参数只显示帮助；带 release ID 和本机 manifest SHA256 时默认 `--check`，只读检查制品、当前发布记录、实际容器/卷、环境和 Nginx 语法。
- `--apply --compatible-migrations-reviewed` 才会写 staging、加载镜像和进入维护窗口；兼容性仍须独立审查，脚本不推断 SQL 的业务含义。
- 固定服务器路径、容器名、端口和命名卷，不接收任意部署根目录。首装、PostgreSQL 升级、换卷、共享 Nginx 变更和破坏性 migration 不属于此入口。
- 只更新后端容器，数据库容器不重建；不导入本地数据，不恢复数据库或删除任何持久卷。
- Nginx 默认保持原样，保存唯一备份并核对前后 SHA256/diff，不自动覆盖其他项目可能产生的并发修改。

## 执行顺序

1. 检查 manifest 和三个制品 SHA256、归档路径、旧发布记录/镜像、现有卷与环境。
2. 在服务继续运行时完成解包、候选 Compose 检查、镜像加载/核验、migration 对照、前端权限和配置备份。
3. 连续维护窗口内停止后端，确认 processing 上传为零，备份数据库和媒体；媒体归档按实际正文逐文件回读校验，拒绝非空 staging、软链接和特殊文件。
4. 创建 v2 发布记录，逐目录切换并启动候选，检查健康、实际镜像、媒体卷、migration、Nginx 未变。
5. 成功仅记 `awaiting_public_verification`，发布记录仍为 `deploying`。公网验收与 `verified` 更新由主负责人按执行文档完成。

维护窗口使用一个 EXIT trap，覆盖普通失败和 INT/TERM。每次移动前设状态，按实际目录位置恢复旧代码；旧镜像恢复后检查健康。新容器尚未创建时仍可恢复旧镜像，Docker 不可达时停止并明确上报。恢复失败会写 `RECOVERY_FAILED`，不会打印“发布成功”。唯一失败目录、备份和日志不自动删除，失败后不能用原 release ID 盲重试。

以下场景没有自动恢复保证：SIGKILL、断电、Docker/文件系统持续不可用、机器重启、migration 已产生旧代码无法读取的数据。不得通过自动回灌备份覆盖新数据。公网验收失败也不会自动触发先前已结束进程的 trap，须按精确发布记录单独审查并执行代码回滚。

## 本地验证

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/server/release.sh
python scripts/server/test_release.py
```

Linux 可使用 `bash -n`；测试可通过 `PANTRY_TEST_BASH` 显式指定 Bash。

离线测试只在临时目录执行实际目录切换/恢复函数，Docker、Compose、数据库、健康检查均由假命令替代；覆盖准备失败不停止旧服务、停服/备份/启动/健康/migration/Nginx 检查失败、四次目录移动分别失败和分别收到 TERM、新容器尚未创建、Docker 不可达、恢复失败明确上报、成功仍待公网验收。另检查归档越界/软链接/重复文件/环境文件、manifest/制品篡改、migration 校验、空/非空媒体备份及 staging 拒绝。

**这些检查证明脚本边界和失败分支，没有证明其已在真实 Linux Docker 或生产服务器执行。** 下次发布须在隔离 Linux Docker 环境做完整普通升级及恢复演练，再按当前候选完成 G3 独立审查；不能以历史 v1.2.0 的部署成功给本脚本背书。
