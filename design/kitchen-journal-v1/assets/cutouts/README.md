# 透明插画资产

2026-09-13。用户授权使用本地图像处理去除插画底色。本目录为可用于页面的成品；上级 `illustration-drafts/` 是有底色的生成原图，不用于页面。

## 使用规范

- 15 幅插画各提供 PNG 与 WebP。PNG 用于留档与后续编辑，页面使用 WebP；透明背景采用真实 alpha。
- 原有三幅：`kitchen-team`、`pantry-home`、`recipe-time`。新增十二幅：`breakfast`、`chicken-greens`、`hotpot-friends`、`market-basket`、`noodle-duo`、`pantry-jars`、`pineapple-rice`、`recipe-afternoon`、`supper-duo`、`three-bowls`、`tofu-soup`、`tomato-egg`。
- 原创人物与食物拼贴为设计示意，不能当作用户真实出餐照片。9 幅既有 SVG 小线稿仍由 `artwork.js` 提供。
- 不把棋盘格画进文件，不用正片叠底、渐变遮罩或同色矩形伪装透明。页面纸纹由 CSS / 独立纹理呈现。
- 白色物件内部可且应保留不透明：书页、盘沿、米饭与人物不能挖空。抗锯齿边缘允许半透明。
- 接入前先检查 RGBA、透明四角和外围边缘，再分别放到暖纸、深绿、透明格背景看细线、白边和物件完整性。

## 加工与复验

脚本 `../../prepare-cutouts.py` 使用本地 U²-Net 前景分离，结合背景连通区、去白边和人工确认的白色物件保护区域。处理不覆盖原图，不上传图片，不在页面运行模型。

脚本依赖 Pillow、NumPy；重新加工还需要 onnxruntime 和模型。此次使用已有本地 Python 依赖，没有安装项目运行依赖。仅校验成品不需要模型：

```powershell
# 在 design/kitchen-journal-v1 目录
python prepare-cutouts.py --verify
```

重新加工默认从系统临时目录读取 `pantry-nook-u2net.onnx`，也可设置 `PANTRY_CUTOUT_MODEL` 指向已下载的模型；脚本不自动下载。可指定素材 ID，例如 `python prepare-cutouts.py recipe-time`。保护轮廓针对当前原图坐标，换原图后必须重新检查，不能直接套用。

模型来自 [rembg 项目发布文件](https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx)，本轮文件 MD5 为 `60024c5c889badc19c04ad937298a77b`；预处理参考 [官方 U²-Net 会话实现](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net.py) 与 [输入归一化实现](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/base.py)。模型留在本机临时目录，没有纳入仓库或页面发布资源。

[alpha-audit.json](alpha-audit.json) 记录 30 个成品的尺寸、透明／不透明占比和体积。检查通过只证明通道及像素约束；还需目视检查。此次 [浅深底对照](../../evidence/v5-alpha-contact-sheet.jpg) 为验证合成图，有背景，不能当透明资产引用。
