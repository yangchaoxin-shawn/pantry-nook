# 食隅记 · 小厨房的拙趣日常

2026-09-13，当前设计预览 05。用户已认可第四版整体风格；本轮处理真实透明底，并增加可选插画。已由 Agent 定向验证，待用户评审，详见 [第五轮说明](iteration-05.md)。

## 打开

- [第五版完整原型](http://127.0.0.1:5194/?v=5)，顶部应显示“设计预览 05”。根路径始终是当前版本，旧 `?v=4` 链接不是第四版快照。
- [第二版保留稿](http://127.0.0.1:5194/v2/)，用于比较上一套水粉与叠纸效果。
- [第三轮插画方向对照](http://127.0.0.1:5194/heytea-direction/)。
- 5194 服务原本已运行，本轮沿用。服务关闭后，在本目录运行 `python -m http.server 5194 --bind 127.0.0.1`。

这是独立设计原型；选图和样例数字仅保存在本页内存，刷新还原。未连接 API、未写浏览器持久化，也未修改正式应用或用户数据库。

## 重点试看

1. 顶部“插画库 · 24”：按场景、搭配、菜品、小线稿筛选，在棉纸、深色、透明格背景中比较。
2. 页头或常用搭配上的“换张插画”：选择候选，点“用这幅插画”；取消保持原图。
3. 切换亮暗主题，查看图片边缘、页面材质和细线人物。页头插画支持短动作，系统减少动态效果及页面暂停均可停用。
4. 原有餐安排、库存详情与录入、核对、空数据／加载／读取失败仍可试用；这些是原型示意，并非正式 API 验收。

## 本轮验证

| 检查 | 本轮结果 |
|---|---|
| 透明素材 | 30 个 PNG / WebP 的 RGBA、透明边缘与主体检查通过；15 幅浅深底对照已目视检查 |
| 语法 | preview.js、illustration-library.js、motion.js、artwork.js 的 node --check 通过 |
| 桌面 1440×900 | 页头亮暗、24 项图库、筛选、取消及搭配独立换图通过；无横向溢出 |
| 平板 768×1024 | 暗色图库、底部应用入口、SVG 应用和 Escape 关闭焦点通过；无横向溢出 |
| 手机 390×844 | 亮色页头、透明格图库、库存跨页面应用、暗色搭配通过；无横向溢出 |
| 动效 | 系统 reduce 时新增预览动画停用，恢复后生效；测试后清除临时设置 |
| 控制台 | 修复旧缓存脚本导致的选图错误；复测无新增 warning / error |
| 范围外 | React runtime、正式 typecheck / lint / build、真实 API、后端、migration 与并发事务本轮不适用、未重跑 |

本轮只检查透明素材和新增选图交互。旧原型表单流程的验证是历史证据，见 [第四轮记录](iteration-04.md)；加载、空态和错误来自预览选择器，不代表真实网络故障注入。修改清单和边界见 [本轮设计记录](iteration-05.md)。

## 截图

- [全部拼贴浅深底对照](evidence/v5-alpha-contact-sheet.jpg)
- [桌面插画库](evidence/v5-desktop-library-light.png)
- [桌面餐安排亮色](evidence/v5-desktop-menu-light.png) · [暗色](evidence/v5-desktop-menu-dark.png)
- [平板暗色插画库](evidence/v5-tablet-library-dark.png)
- [手机餐安排](evidence/v5-mobile-menu-light.png) · [透明格预览](evidence/v5-mobile-library-checker.png)
- [手机库存应用新图](evidence/v5-mobile-stock-choice.png) · [手机暗色搭配](evidence/v5-mobile-plans-dark.png)

## 当前结构与历史

- `index.html`、`preview.js`：原型骨架与内存交互；不是业务实现来源。
- `preview.css`、`artful.css`：基础布局与材质；`illustrations.css`：透明插画、图库与响应式布局。
- `illustration-library.js`：15 幅拼贴与 9 幅小线稿的候选及应用逻辑。
- `artwork.js`：9 个原创 SVG 场景；`motion.js`：动画、暂停和弹窗反馈。
- `assets/cutouts/`：当前实际使用的透明插画，含 [素材规范](assets/cutouts/README.md)。
- `assets/illustration-drafts/`：12 幅原始样张；`prepare-cutouts.py`：经授权的本地处理与透明校验。
- `v2/`：第二版快照，仅为历史比较；使用旧素材，不继续修改。
- `heytea-direction/`：第三轮插画研究与对照，主餐页复用其中已认可的插画。
- [第一轮参考分析](analysis.md) · [第二轮历史说明](iteration-02.md) · [第三轮插画研究](heytea-direction/research.md)。

后续接入正式前端时使用透明成品，不复用原始样张充当透明素材。图片候选不授予新增业务字段、接口或上传功能的权限。旧结果仅为历史证据，正式 React 重构与联调尚未实施。
