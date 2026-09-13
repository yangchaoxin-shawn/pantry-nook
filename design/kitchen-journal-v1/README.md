# 食隅记 · 小厨房的拙趣日常

2026-09-13，当前设计预览 07。本轮降低纹理存在感，用暖灰白背景、浅绿标题区和奶白内容面拉开层次。已由 Agent 定向验证，待用户评审，详见 [第七轮说明](iteration-07.md)。

## 打开

- [第七版完整原型](http://127.0.0.1:5194/?v=7)，顶部应显示“设计预览 07”。根路径始终是当前版本，旧 `?v=6` 链接不是第六版快照。
- [第二版保留稿](http://127.0.0.1:5194/v2/)，用于比较上一套水粉与叠纸效果。
- [第三轮插画方向对照](http://127.0.0.1:5194/heytea-direction/)。
- 5194 服务原本已运行，本轮沿用。服务关闭后，在本目录运行 `python -m http.server 5194 --bind 127.0.0.1`。

这是独立设计原型；自动插画分配、选图和样例数字仅保存在本页内存，刷新还原。未连接 API、未写浏览器持久化，也未修改正式应用或用户数据库。

## 重点试看

1. “菜品 → 添加菜品”：只填名称保存，自动得到一位小人。24 种姿态打乱分配，一轮内不重复，不根据菜名匹配食物图片。切页、改名后保持原图。
2. “常用搭配 → 创建搭配”：选菜保存也自动配小人，移除逐张换图步骤。点一下小人可看短动作。
3. 顶部“插画样张 · 48”：含 24 种小人、15 幅透明拼贴和 9 幅场景线稿。在奶白、深色、透明格中比较；这里只手动预览页头。
4. 重点看库存页“家里还有什么”与外部背景的色差，以及搜索框、列表、弹窗的干净表面。切换亮暗主题，字体、插画与现有动画继续保留。
5. 原有餐安排、库存详情与录入、核对、空数据／加载／读取失败仍可试用；这些是原型示意，并非正式 API 验收。

## 本轮验证

| 检查 | 本轮结果 |
|---|---|
| 桌面 1440×900 | 库存亮暗表面分离；实际样式确认搜索、列表、按钮不再有背景纹理图片，无横向溢出 |
| 平板 768×1024 | 餐安排亮色、侧边便签及图库奶白表面通过；透明检验棋盘保留 |
| 手机 390×844 | 库存／菜品亮色、搭配暗色、录入弹窗暗色通过；底栏无纸纹，数量可读，无横向溢出 |
| 独立审查 | 子 agent 只读检查纹理继承、暗色优先级、加载渐变等遗漏项；无阻塞问题，滚动条槽底色差异已修复 |
| 语法 | 仅改设计文案的 preview.js、illustration-library.js 的 node --check 通过 |
| 文档与差异 | 56 个本地链接及 git diff --check 通过 |
| 控制台 | 本轮所查 warning / error 为空 |
| 范围外 | React runtime、正式 typecheck / lint / build、真实 API、后端、migration 与并发事务本轮不适用、未重跑 |

本轮仅调整视觉表面与设计文案；字体、插画分配、动效与业务逻辑未改，相关旧结果见 [第六轮记录](iteration-06.md)，不作为本轮复测证明。本轮没有重跑全量业务、自动配图、动效或全部状态矩阵。修改清单和边界见 [本轮设计记录](iteration-07.md)。

## 截图

- [桌面库存亮色](evidence/v7-desktop-stock-light.png) · [暗色](evidence/v7-desktop-stock-dark.png)
- [平板餐安排亮色](evidence/v7-tablet-menu-light.png)
- [手机库存亮色](evidence/v7-mobile-stock-light.png) · [手机菜品亮色](evidence/v7-mobile-catalog-light.png)
- [手机录入暗色](evidence/v7-mobile-entry-dark.png) · [手机搭配暗色](evidence/v7-mobile-plans-dark.png)
- 已有拼贴透明检查留在 [第五轮历史记录](iteration-05.md)。

## 当前结构与历史

- `index.html`、`preview.js`：原型骨架与内存交互；不是业务实现来源。
- `preview.css`、`artful.css`：基础布局与材质；`illustrations.css`：图库与响应式；`handcrafted.css`：本轮字体、纸面、小人及短动效。
- `little-people.js`：24 种姿态与自动分配；`verify-people.cjs`：定向检查。
- `illustration-library.js`：48 项样张及页头应用逻辑。
- `handwriting.css`、`assets/fonts/`：本地手写字体，来源与 OFL 许可见 [字体说明](assets/fonts/README.md)；`prepare-handwriting.py` 为分包脚本。
- `assets/paper-v6.webp`、`assets/paper-grain-v6.webp`：上一轮纸纹素材，当前页面不再加载；`prepare-paper.py` 作为历史制备脚本保留。
- `artwork.js`：9 个原创 SVG 场景；`motion.js`：动画、暂停和弹窗反馈。
- `assets/cutouts/`：当前实际使用的透明插画，含 [素材规范](assets/cutouts/README.md)。
- `assets/illustration-drafts/`：12 幅原始样张；`prepare-cutouts.py`：经授权的本地处理与透明校验。
- `v2/`：第二版快照，仅为历史比较；使用旧素材，不继续修改。
- `heytea-direction/`：第三轮插画研究与对照，主餐页复用其中已认可的插画。
- [第一轮参考分析](analysis.md) · [第二轮历史说明](iteration-02.md) · [第三轮插画研究](heytea-direction/research.md)。

后续接入正式前端时使用透明成品，不复用原始样张充当透明素材。图片候选不授予新增业务字段、接口或上传功能的权限。旧结果仅为历史证据，正式 React 重构与联调尚未实施。
