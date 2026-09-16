# 实况传输与公开真实样本验证

日期：2026-09-16。承接[影集技术验证](photo-journal-technical-validation-2026-09-16.md)，本轮只做调研和独立样本实验，不修改正式影集功能，不部署。

## 微信传电脑只看到 JPG，意味着什么

不能只看扩展名。苹果 Live Photo 通常由照片与 MOV 配对；安卓 Motion Photo 可以将视频放在同一个 JPG / HEIC 中。Windows 只显示静图也不足以判断视频是否还在。Android 规范特别提醒：实况标志可能残留，但视频已被移除，必须检查实际内容。

本轮检查用户已授权的“素材”目录现有 5 张微信 JPG：ExifTool 未读到实况标志或配对标识，不能提取 MotionPhotoVideo / EmbeddedVideoFile，JPEG 结束后的附加内容均仅 24 字节，未发现实况视频。本结论仅针对这 5 个文件；不代表微信所有版本/分享方式均不支持实况。若手机原图能播放，这些静态副本不能恢复已缺失的动态，需要重新导出原始素材。

## 推荐操作

### iPhone / iPad

1. **优先保留原件：**“照片”选择实况 → 共享 →“导出未修改的原片”→ 保存到“文件”。将得到的素材完整保留，检查照片与对应 MOV；具体系统版本导出的组织形式仍需实测。后续网页可从“文件”选取，不依赖相册选择器必然交付全部资源。
2. **已有 iCloud 照片：**Windows 浏览器打开 iCloud.com/photos → 选照片 → 更多 → 更多下载选项 →“未修改的原片”→ 下载，若是压缩包先解压，再检查配对文件。不要将“兼容性最好”等同于原件。
3. **只要方便记录动态：**打开实况 → 更多 →“存储为视频”。这是额外导出的视频，原实况仍保留在相册；不能称为完整 Live Photo 原片归档。

若需要借微信传输，可先将已经完整导出的照片与 MOV 压成 ZIP，作为普通文件发送，再在电脑解压核对。压缩包不会凭空补出缺少的视频；本轮未操作用户微信，未验证该客户端的文件传输链路。

### Android

优先通过 USB 文件传输复制相机目录原文件。JPG 也可能是完整动态照片，不必为了扩展名转换格式。项目应检查内部视频；不能强制所有设备都提交照片＋MOV 两个文件。不同厂商的“导出视频”是兼容分享路径，不等于原始动态照片归档。

## 自行取得的公开素材

原文件、下载清单与证据仅保存在 Git 忽略的 `.review/photo-spike/live-real/`。下载记录包含固定源提交、路径、字节数与 SHA256；未将公开照片混入生产业务或上传到第三方服务。

| 样本 | 原始结构 | 验证结果 |
|---|---|---|
| iPhone 15 | HEIC 5,120,446 字节 + MOV 3,922,900 字节 | 图像 Apple ContentIdentifier 与 MOV Keys ContentIdentifier 相等；MOV 为 HEVC、1920×1440、约 2.005 秒 |
| Pixel 8a | JPG 6,061,475 字节 | 从 JPG 提取出实际 HEVC 视频，1440×1080、约 1.679 秒；提取结果确为原件内连续字节 |
| Samsung One UI 6（元数据 SM-S906U） | HEIC 3,678,952 字节 | 提取出实际 HEVC 视频，1440×1080、约 3.130 秒；提取结果确为原件内连续字节 |

来源：

- [NightMean/MotionPhotoSamples](https://github.com/NightMean/MotionPhotoSamples/tree/f2f1f93db1d01bbdb8d71122d3bbe2dba59a2a78)，苹果配对文件；作者明确用于分析的样本仓库，未发现通用素材许可，仅用于本地分析，不作为产品展示素材分发。
- [Immich test-assets](https://github.com/immich-app/test-assets/tree/ec56cc6c1d76c45bc9615dc6ea232470a2b0a3a1/formats/motionphoto)，Pixel 与三星样本；仓库 README 声明素材为 public domain，代码仓库许可与素材声明分开记录。

## 实际测试与限制

- 复用 ExifTool 13.59（隔离下载 exiftool-vendored.exe 13.59.2）、已有 FFprobe/FFmpeg 与前轮 Pillow/HEIF 环境，不手写厂商格式解析器，不升级正式项目依赖。
- 3 个图像原文件通过带测试标志的本地 3057 上传并下载，逐字节与 SHA256 一致；安卓内嵌视频随原文件一起保留。**Apple MOV 未上传到该图片接口，尚未验证双文件持久配对。**
- 3 个视频分别生成 H.264、8 位 4:2:0、AAC（原有音轨时）兼容副本，校验流、时长差异和音轨存在性。原件始终另存且 SHA256 未变。转码/预览不承诺无损、HDR 或广色域完全一致。
- Windows Edge 自动化实际解码并播放 3 个兼容副本：时间推进、已解码视频帧和尺寸非零、默认静音、无页面异常。**不是原 HEVC 的直接跨端播放证明，也不是 iOS/Android 相册选择器实测。**
- 静态负例不能提取视频；另保留 MotionPhoto=1 元数据但移除视频的负例，同样没有实际视频，证明不能仅凭标志判完整实况。Apple 缺 MOV 或标识不匹配的业务拒绝流程仍属正式接入待实现项。
- 本轮先发生兼容副本像素格式断言失败：原片 full-range 色彩标志导致输出被识别为 yuvj420p；显式转换展示副本的亮度范围后重新通过。没有修改原件，也没有借此声称颜色专项验收完成。

复跑入口：`download_samples.py`、`verify_real.py`、`check-playback.mjs`。证据：`sources.json`、`evidence-real.json`、`evidence-playback.json`、`playback.png`，均相对于上述隔离目录。主负责人亲自运行并查看截图；独立 agent 审查测试边界。没有重启设计服务，临时播放测试服务器已关闭。

## 对正式实现的影响

不再等待用户提供素材才能开始格式验证；已经有三种设备的公开真实样本可复跑。正式实现应分别处理苹果配对文件与安卓单文件动态照片；实况另存视频可作为兼容导入候选，是否开放任意视频上传仍需冻结范围。仍需后续用户设备验证系统选择器交付、Apple 双文件上传/缺失/错配处理、视频鉴权与持久化、触摸交互及色彩表现，不能将本次实验标记为产品“已支持实况”。

## 官方依据

- [Apple：下载原片到文件 / iCloud 网页下载选项](https://support.apple.com/zh-cn/111762)。
- [Apple：实况存储为视频](https://support.apple.com/zh-cn/105029)。
- [Apple：分享给不支持的设备或服务可能只分享静图](https://support.apple.com/en-om/guide/iphone/iphf28f17237/ios)。
- [Apple LivePhotosKit JS](https://developer.apple.com/documentation/livephotoskitjs)。
- [Android Motion Photo 格式及残留标志警告](https://developer.android.com/media/platform/motion-photo-format)。
- [Android：通过 USB 向 Windows 传输文件](https://support.google.com/android/answer/9064445?hl=zh-Hans)。
