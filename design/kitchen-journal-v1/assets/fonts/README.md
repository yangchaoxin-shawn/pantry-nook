# 本地手写字体

本目录基于 [小赖字体 Xiaolai v3.126](https://github.com/lxgw/kose-font/releases/tag/v3.126) 的 `Xiaolai-Regular.ttf` 制成 WOFF2 分包。字形为中文手写风格，原作者及衍生关系见 [字体项目](https://github.com/lxgw/kose-font)；并非喜茶官方字体，也未识别或声称与参考字体完全相同。

原始字体 SHA-256：`e2f68daf0e72777a8cf58bc83de1b98634b251e537ddbfca24b0ae50d1802da2`。保留 [OFL 1.1 许可与版权](OFL-Xiaolai.txt)，转换后的内部家族名为 `Pantry Hand`，字形没有重新绘制。

- 页面固定文案优先包 `hand-ui.woff2`：114,104 字节。
- 源字体其余字符按 Unicode 范围分包，支持任意新菜名；总共 45 包、44,871 个字符映射，约 12.48 MB。由 `unicode-range` 按需要加载，不在首屏下载全部字体。
- 字体源文件保存在本机临时目录 `pantry-xiaolai-v3.126.ttf`，没有安装到 Windows，也没有修改项目 npm / Python 运行依赖。
- 脚本 `../../prepare-handwriting.py` 使用已有 fontTools / brotli；读取页面文案和本地源文件，生成分包、`../../handwriting.css` 与 [体积清单](manifest.json)。新增固定文案时可重新生成；即使未重新生成，其他字符仍可通过相应分包显示。

字体用于标题、菜名、按钮及短文案；数量、小数、分数、日期等数据继续使用清晰的系统字体。`font-display: swap` 允许加载期间使用回退字体，不能声称完全消除了字体切换。
