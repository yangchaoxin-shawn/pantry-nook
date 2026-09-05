# Git 规范

本项目采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)。

## 提交信息格式

```text
<type>(<scope>): <描述>

[可选正文]

[可选脚注]
```

- 描述用中文，一句话说清做了什么，结尾不加句号
- 正文可选，解释"为什么"而不是"做了什么"

## type 一览

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 只改文档 |
| `style` | 代码格式调整（不影响逻辑） |
| `refactor` | 重构（不改功能） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建/依赖变更 |
| `chore` | 杂务（工具配置等） |

## scope 一览

| scope | 覆盖范围 |
|---|---|
| `backend` | backend/ 目录 |
| `frontend` | frontend/ 目录 |
| `db` | 数据库结构、迁移、脚本 |
| `docs` | docs/ 及根目录文档 |
| `deploy` | Docker、Nginx、部署相关 |

不适用任何 scope 时可省略，如 `chore: 初始化项目结构`。

## 示例

```text
feat(backend): 添加今日作战确认接口
fix(frontend): 修复确认后库存列表不刷新
docs(prd): 明确撤销确认的库存回退规则
refactor(db): 消耗表增加关联菜品字段
build(deploy): 后端镜像升级 Node 20
```

## 破坏性变更

两种写法任选（可并用）：

```text
feat(backend)!: 今日作战确认改为两阶段提交

BREAKING CHANGE: 确认接口从 PATCH 改为 POST /confirm
```

## 分支策略

单人项目，从简：

```text
main        始终可运行、可部署
feat/xxx    较大功能开发分支，完成后合回 main
```

日常小改动直接提交 main。

## 不进 Git 的内容

`.gitignore` 已覆盖：

- `.env`（数据库密码等敏感配置）
- `node_modules/`、`dist/`
- 日志 `*.log`
- 编辑器/系统文件
- `CLAUDE.local.md`、`.claude/settings.local.json`（个人本地偏好）
