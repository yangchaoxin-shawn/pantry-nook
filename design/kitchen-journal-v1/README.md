# 食隅记 · 小厨房的拙趣日常

2026-09-13，完整设计预览 04，待用户评审。用户已认可第三轮的插画方向；本轮将它融入完整页面，设计取舍见 [第四轮说明](iteration-04.md)。

## 打开

- [第四版完整原型](http://127.0.0.1:5194/?v=4)，顶部应显示“设计预览 04”。
- [第二版保留稿](http://127.0.0.1:5194/v2/)，用于比较上一套水粉与叠纸效果。
- [第三轮插画方向对照](http://127.0.0.1:5194/heytea-direction/)。
- 5194 服务原本已运行，本轮沿用。服务关闭后，在本目录运行 `python -m http.server 5194 --bind 127.0.0.1`。

这是独立设计原型；所有数字驻留本页内存，刷新还原。未连接 API、未写浏览器持久化，也未修改正式应用或用户数据库。

## 重点试看

1. 切换餐安排、库存、菜品：三幅食物拼贴与线稿人物形成不同的小故事。
2. 点击页头插画，看主图的轻微位移、小人或装饰的短动作。
3. 打开库存详情、批量录入、安排餐与核对，观察纸面材质和不同的场景小画。
4. 切换日间与夜间：暖纸、细织纹、柔和光影，以及夜间的深绿纸底与浅色插画纸片。
5. 顶部切换空数据、加载、读取失败；点击暂停动效或使用系统减少动态效果。
6. 试填一行批量食材；今天晚餐用 1/3 西兰花确认；今天午餐查看缺货与去库存处理入口。

## 本轮验证

| 检查 | 本轮结果 |
|---|---|
| 语法 | preview.js、motion.js、artwork.js 的 node --check 通过 |
| 桌面 1440×900 | 三主页面亮色、搭配暗色；资源正常，无横向溢出 |
| 平板 768×1024 | 餐安排亮色、库存暗色；两栏与分组清单正常，无横向溢出 |
| 手机 390×844 | 三主入口、亮暗、详情／批量／核对／安排用料弹窗；无横向溢出 |
| 原型流程 | 批量只填一行保存成功；1/3 确认进入历史；不足时阻止确认，进入库存并返回核对 |
| 动效 | 主图变换和小人动画生效；手动暂停及系统 reduce 后停止；测试后恢复 |
| 控制台 | 本轮所查 warning / error 为空 |
| 范围外 | React runtime、正式 typecheck / lint / build、真实 API、后端、migration 与并发事务本轮不适用、未重跑 |

加载、空态和错误来自预览选择器，不代表真实网络故障注入。素材、实现文件、完整边界见 [本轮设计记录](iteration-04.md)。

## 截图

- [桌面餐安排亮色](evidence/v4-desktop-menu-light.png)
- [桌面库存亮色](evidence/v4-desktop-stock-light.png)
- [桌面菜品亮色](evidence/v4-desktop-catalog-light.png)
- [桌面搭配暗色](evidence/v4-desktop-plans-dark.png)
- [平板餐安排亮色](evidence/v4-tablet-menu-light.png)
- [平板库存暗色](evidence/v4-tablet-stock-dark.png)
- [手机餐安排亮色](evidence/v4-mobile-menu-light.png) · [暗色](evidence/v4-mobile-menu-dark.png)
- [手机库存亮色](evidence/v4-mobile-stock-light.png)
- [手机菜品暗色](evidence/v4-mobile-catalog-dark.png)
- [手机库存详情](evidence/v4-mobile-detail-light.png)
- [手机批量记录](evidence/v4-mobile-batch-light.png)
- [手机核对用量](evidence/v4-mobile-review-light.png)
- [手机安排用料暗色](evidence/v4-mobile-arrange-dark.png)
- [手机读取失败暗色](evidence/v4-mobile-error-dark.png)

## 当前结构与历史

- `index.html`、`preview.js`：原型骨架与内存交互；不是业务实现来源。
- `preview.css`：基础布局；`artful.css`：第四轮统一视觉层。
- `artwork.js`：9 个原创 SVG 场景；`motion.js`：动画、暂停和弹窗反馈。
- `assets/`：纸纹与原创插画；无远程字体或图片依赖。
- `v2/`：第二版快照，仅为历史比较；使用旧素材，不继续修改。
- `heytea-direction/`：第三轮插画研究与对照，主餐页复用其中已认可的插画。
- [第一轮参考分析](analysis.md) · [第二轮历史说明](iteration-02.md) · [第三轮插画研究](heytea-direction/research.md)。

旧结果仅为历史证据。当前待用户评审，正式 React 重构与联调尚未实施。
