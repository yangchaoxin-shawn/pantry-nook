# Apple 真机反馈：格式兼容与实况补传

## 已确认与待确认

用户真机结果：安卓正常；iPhone 部分相册实况报格式不支持；iPad 上传后提示缺少动态。用户提供目录只有截图，未包含失败原片。

旧评审库只读记录证实 `IMG_8481.jpeg` 在处理阶段失败；`IMG_0093.jpeg` 已识别为 Apple 照片但没有配对视频。失败原片按既有临时文件规则清理，不能由截图反推其编码。

实际生成 MPF JPEG 可稳定复现同一错误：ExifTool 判为 JPEG，锁定版 Pillow 12.3.0 判为 MPO，旧白名单拒绝。这是已确认的兼容缺陷，但尚不能断定用户失败原片就是 MPO。修复后仍须原照片真机复测。

## 修复与限制

- 接受 JPEG 容器中的 MPO 主图，按 `image/jpeg` 处理；主图预览处理旋转并移除元数据，原件字节不改变。副图不作为实况视频，Apple 配对标识仍按真实元数据识别。
- 不支持的已识别图片格式在错误中显示格式名；扩展名、实际内容、50 MiB、6000 万像素、超时等限制保持。
- 相册入口补齐 MIME 提示；新增 Apple 帮助与原件文件选择入口。缺视频的照片可点“补充 MOV”，按真实标识自动配对；可以先存静态照片，之后编辑补传。
- 若相册已改写照片且丢失配对标识，需用同一组导出的照片和 MOV 替换；不靠同名强行配对。
- 网页只能处理系统交给它的文件。直接从 iOS/iPadOS 相册选择，不能保证取得 Live Photo 的两个组成文件。换上传组件或加 accept 类型不能补造缺失的视频。
- 保留画质指收到的原文件不改写；系统交付前发生的转换无法逆转。页面预览与原件不同，不承诺原生 HDR 效果。

## 调研与复用

- [Pillow JPEG factory](https://pillow.readthedocs.io/en/stable/_modules/PIL/JpegImagePlugin.html)：JPEG 的 MPF 元数据可触发 MpoImageFile；复用现有 Pillow，不增加依赖。
- [WebKit 文件上传实现](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm)：当前源码选择单个图像或视频文件表示，不等价于原生 PhotoKit 资源导出；当前源码不是用户安装版本的完整行为证明。
- [Apple pairedVideo](https://developer.apple.com/documentation/photos/phassetresourcetype/pairedvideo)：原生应用可读取 Live Photo 配对资源，微信原生能力不能直接照搬到网页。
- [Apple 导出原片说明](https://support.apple.com/zh-cn/guide/iphone/iph480caa1f3/ios)：查找“导出未修改的原片”，官方路径涉及连接外置存储设备。必须核对结果包含照片和 MOV；普通“存储到文件”不能保证完整。
- [LivePhotosKit JS](https://developer.apple.com/documentation/livephotoskitjs)：解决已有照片和视频的展示，不能提取相册未交付的视频。沿用现有上传、配对与播放链路，不重复引入组件。

## 当前验证

- 主负责人：Windows 手记相关 22 项后端测试通过，包含真实 ExifTool/FFmpeg 与 Apple、Pixel、Samsung 原片。
- 主负责人：前端类型、lint、17 项手记测试与构建通过。
- 主负责人：3070 独立库真实 API 13 组检查通过，含原件字节、错误配对、缺视频、安卓实况与契约。
- 实现 agent：Linux Docker 新增 7 项媒体测试全部通过，无跳过；镜像 `pantry-nook-backend:apple-live-fix-test`。未启动服务，测试与公开素材只读挂载，容器无网络且根文件系统只读。
- 独立审查 agent：格式边界、原件保留、真实配对和前端恢复入口无阻断；已修正官方导出按钮名称及外置存储前提。
- 主负责人：浏览器真实 API 闭环通过，照片先存为静态、编辑补 MOV、仍为一张且原件字节不变、真实播放；MPO/JPEG 上传保存和 MIME 验证通过；390/834 宽度帮助无横向溢出，无页面运行异常。脚本 `scripts/journal-apple-browser-test.mjs`，证据 `.review/apple-browser/result.json`。
- 测试执行中修正了新脚本对既有状态枚举的误写；另一次与媒体 API 脚本同时上传触发既有并发忙碌保护，顺序执行后通过。两组媒体写入测试应顺序运行。
- iPhone 原失败照片、iPad 实际原件导出/文件选择流程仍待用户复测；桌面模拟屏宽不代表 iOS/iPadOS 真机通过。

## 环境边界

分支 `codex/apple-live-fix`，工作区 `C:\Users\yangchaoxin\.codex\worktrees\apple-live-fix\pantry-nook`，从 `dc12e68` 创建。修复测试前端 5226，后端 3070，独立库 `pantry_nook_test_6911d568cdd64f25a1d7dd440198142f` 与独立媒体目录。旧 5223/5224/3067 和用户照片未修改。

无接口、migration、依赖、版本、tag 或线上变更。本次不是发布门禁；正式发布前仍需完整类生产预检。用户照片与测试素材不进入 Git。

新手机复测入口：`http://10.207.141.99:5227/`，使用同一 Wi-Fi/热点；IP 为当时 WLAN 地址，换网须重新核对。5227 与 5226 共用本轮独立测试库。开始交付用户后停止自动写入该库。
