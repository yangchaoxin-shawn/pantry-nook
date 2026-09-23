# Pantry Nook — 开发交接索引

本页只维护入口和交接方法；版本、发布状态、开发基线与下一步统一见 [项目状态](docs/project-status.md)。历史原型和旧分支不能代替当前基线。

Claude Code 与 Codex 双向接续使用 [桌面交接说明](docs/desktop-handoff.md)。用户指定桌面目录为固定交付位置；本页保留原文件名供已有入口使用。

1. 读取 [AGENTS.md](AGENTS.md)、[项目状态](docs/project-status.md) 和 [协作流程](docs/collaboration.md)。
2. 根据交接给出的准确开发 ref，在实际目标目录运行 [基线检查](scripts/check-handoff.ps1)；核对实际 HEAD、干净状态和发布祖先关系。错误基线先纠正，不在旧分支上复制几份文档冒充同步。
3. 按任务读取 [PRD](docs/PRD.md) 对应模块、实现代码、[API 契约](contracts/openapi.yaml) 与 [测试说明](backend/TESTING.md)，无需重读全部历史报告。
4. 新会话返回实际工作区、HEAD、当前任务范围和未决项后，才算交接完成；收到排队 ID 不代表代码起点已核实。

已批准范围内的事实文档修正和必要收尾可直接完成。新产品取舍、版本/tag、部署与数据操作按实际授权处理；已有生产数据持久保护，本地自动化使用独立测试库。

设计先继承当前产品公共组件与交互；历史视觉材料见 [设计输入](docs/frontend-design-handoff.md)。本地启动见 [README](README.md)，提交见 [Git 约定](docs/git.md)，公司服务器操作见 [部署入口](DEPLOY.md)。
