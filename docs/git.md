# Git 与版本约定

更新：2026-09-11。主分支 main，当前无远程仓库。远程地址/推送须另行确定。

## 提交

采用 Conventional Commits，中文说明具体问题或行为。常用 scope：backend、frontend、db、docs、deploy。
不适合 scope 时可省略；既有提交的 core/test 等 scope 是历史，不重写提交历史。

```text
fix(frontend): 批量录入忽略未填写的空白行
fix(backend): 阻止过期库存版本覆盖新数据
docs: 统一当前规格与 Agent 协作入口
```

同一行为的代码、API、必要测试和文档放在一个可审查的改动中。
只 stage 本轮文件，不顺带提交用户改动、测试数据或个人配置；重大规则变化写明影响。
检查通过后建立本地提交，不能以提交成功代替验证或用户验收。

## 分支与验收

小范围已批准改动可提交 main；较大功能默认使用 codex/<任务名>，沿用用户明确指定的分支。
main 是本地稳定候选基线，不表示已经部署或全部用户验收通过。
用户准备/正在验收时，不在同一运行目录修改功能并触发热更新；后续隔离开发需独立代码、端口和数据库。

现有 .claude/worktrees/ 是 Claude 遗留工作区，不是当前隔离开发环境。
不能未经检查清理、强制重置或合并。Git worktree 共享仓库元数据，并不会自动隔离进程和数据库。

## 已建立的基线

- dc2429b：初始项目结构。
- 3893220：本地核心功能闭环基线。
- 35f1dca：当前验收数据脚本。

这些是历史检查点；最新版本用 git log/status 核验。
提交前按 [协作流程](collaboration.md) 选择检查并记录结果；不为提交文档重跑全量业务测试。
无新改动/失败/未解决疑虑时，不重复相同检查。

## 排除与保护

.env、数据库备份、依赖、构建产物、日志及个人 Claude 配置不进 Git。
.claude/settings.local.json、CLAUDE.local.md、.claude/worktrees/ 已由仓库 .gitignore 排除。
不要为了迁移工具把 Claude 权限允许列表提交到仓库或改写为 Codex 权限。
Docker/Nginx 等到明确的发布阶段才实施和验证；不提前进行部署提交。
