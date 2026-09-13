# 食隅记 · 小厨房的拙趣日常

2026-09-13，当前设计预览 06。本轮按用户反馈引入手写字、细密纸面及自动分配的小人装饰。已由 Agent 定向验证，待用户评审，详见 [第六轮说明](iteration-06.md)。

## 打开

- [第六版完整原型](http://127.0.0.1:5194/?v=6)，顶部应显示“设计预览 06”。根路径始终是当前版本，旧 `?v=5` 链接不是第五版快照。
- [第二版保留稿](http://127.0.0.1:5194/v2/)，用于比较上一套水粉与叠纸效果。
- [第三轮插画方向对照](http://127.0.0.1:5194/heytea-direction/)。
- 5194 服务原本已运行，本轮沿用。服务关闭后，在本目录运行 `python -m http.server 5194 --bind 127.0.0.1`。

这是独立设计原型；自动插画分配、选图和样例数字仅保存在本页内存，刷新还原。未连接 API、未写浏览器持久化，也未修改正式应用或用户数据库。

## 重点试看

1. “菜品 → 添加菜品”：只填名称保存，自动得到一位小人。24 种姿态打乱分配，一轮内不重复，不根据菜名匹配食物图片。切页、改名后保持原图。
2. “常用搭配 → 创建搭配”：选菜保存也自动配小人，移除逐张换图步骤。点一下小人可看短动作。
3. 顶部“插画样张 · 48”：含 24 种新小人、15 幅已有透明拼贴和 9 幅已有场景线稿。在棉纸、深色、透明格中比较；这里只手动预览页头。
4. 切换亮暗主题，查看真实手写字、纸纤维和插画边缘。数量与日期保持清晰字体；系统减少动态效果及页面暂停均可停用动画。
5. 原有餐安排、库存详情与录入、核对、空数据／加载／读取失败仍可试用；这些是原型示意，并非正式 API 验收。

## 本轮验证

| 检查 | 本轮结果 |
|---|---|
| 字体与素材 | 浏览器标题实际渲染 Pantry Hand；45 个 WOFF2 分包按需加载，固定 UI 分包约 114 KB；新人物为透明 SVG |
| 语法与分配 | 3 个变更脚本 node --check；verify-people.cjs 的首轮唯一、稳定重绘、改名、后续循环、搭配命名空间检查通过 |
| 桌面 1440×900 | 菜品亮色、库存暗色、小人图库和空态／加载／读取失败示意检查通过；导航换行与暗色控件纸底已修复 |
| 平板 768×1024 | 餐安排亮色、搭配暗色及新建搭配自动配图通过；无横向溢出 |
| 手机 390×844 | 菜品亮色、库存／搭配暗色、单个录入及核对用料表单检查通过；无横向溢出 |
| 新增与改名 | 空菜名被拦截；只填“蒜蓉秋葵”保存即配图，原六道菜保持；改名及切页后保持 |
| 动效 | 手机触摸触发 person-wave；系统 reduce 时为 none，测试后恢复临时设置 |
| 控制台 | 本轮所查 warning / error 为空 |
| 范围外 | React runtime、正式 typecheck / lint / build、真实 API、后端、migration 与并发事务本轮不适用、未重跑 |

本轮检查新字体、纸面、自动配图和受影响表单。加载、空态和错误来自预览选择器，不代表真实网络故障注入。完整旧业务流程未重跑；修改清单和边界见 [本轮设计记录](iteration-06.md)。

## 截图

- [桌面小人样张](evidence/v6-desktop-people-library.png)
- [桌面菜品亮色](evidence/v6-desktop-catalog-light.png) · [库存暗色](evidence/v6-desktop-stock-dark.png)
- [平板餐安排亮色](evidence/v6-tablet-menu-light.png) · [搭配暗色](evidence/v6-tablet-plans-dark.png)
- [手机菜品](evidence/v6-mobile-catalog-light.png) · [库存暗色](evidence/v6-mobile-stock-dark.png)
- [手机录入暗色](evidence/v6-mobile-entry-dark.png) · [手机搭配暗色](evidence/v6-mobile-plans-dark.png) · [手机核对亮色](evidence/v6-mobile-review-light.png)
- 已有拼贴透明检查留在 [第五轮历史记录](iteration-05.md)。

## 当前结构与历史

- `index.html`、`preview.js`：原型骨架与内存交互；不是业务实现来源。
- `preview.css`、`artful.css`：基础布局与材质；`illustrations.css`：图库与响应式；`handcrafted.css`：本轮字体、纸面、小人及短动效。
- `little-people.js`：24 种姿态与自动分配；`verify-people.cjs`：定向检查。
- `illustration-library.js`：48 项样张及页头应用逻辑。
- `handwriting.css`、`assets/fonts/`：本地手写字体，来源与 OFL 许可见 [字体说明](assets/fonts/README.md)；`prepare-handwriting.py` 为分包脚本。
- `assets/paper-v6.webp`、`assets/paper-grain-v6.webp`：底纸与透明纤维；`prepare-paper.py` 为制备脚本。
- `artwork.js`：9 个原创 SVG 场景；`motion.js`：动画、暂停和弹窗反馈。
- `assets/cutouts/`：当前实际使用的透明插画，含 [素材规范](assets/cutouts/README.md)。
- `assets/illustration-drafts/`：12 幅原始样张；`prepare-cutouts.py`：经授权的本地处理与透明校验。
- `v2/`：第二版快照，仅为历史比较；使用旧素材，不继续修改。
- `heytea-direction/`：第三轮插画研究与对照，主餐页复用其中已认可的插画。
- [第一轮参考分析](analysis.md) · [第二轮历史说明](iteration-02.md) · [第三轮插画研究](heytea-direction/research.md)。

后续接入正式前端时使用透明成品，不复用原始样张充当透明素材。图片候选不授予新增业务字段、接口或上传功能的权限。旧结果仅为历史证据，正式 React 重构与联调尚未实施。
