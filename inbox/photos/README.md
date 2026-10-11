# inbox/photos/ —— 原始照片投递箱

把要上站的照片直接拖进这个目录（可以建相册子目录），构建时会自动：

1. 按 EXIF 摆正方向、剥掉元数据；
2. 等比压缩到最大宽度 2000px；
3. 转成 **WebP**（`assets/photos/xxx.webp`）并生成 900px 缩略图（`assets/photos/xxx.thumb.webp`）；
4. 结果写进 `assets/photos/manifest.json`，页面上的摄影板块按热度（sidecar 里的 `heat`，不显示）与日期排序展示。

**这个目录里的原始文件不会进 git**（见仓库根的 `.gitignore`），否则仓库会被大图撑爆；
只有压缩后的 WebP 产物会被提交。

## 可选：给照片配文字

同名的 `.md` / `.txt` / `.json` 会被当成元数据，例如 `sunrise.jpg` 配 `sunrise.md`：

```md
---
title: 清晨的雪线
date: 2026-10-11
location: 川西 · 四姑娘山
tags: [风景, 雪山]
album: 2026 川西
heat: 3
---

正文会作为照片说明（caption）显示在灯箱里。
```

不写也没关系：标题取文件名，日期取 EXIF 拍摄时间（没有就用文件时间），地点取所在子目录名。

## 命令

```sh
npm run photos      # 只跑照片流水线
npm run build       # 照片 + 文本一起重建
npm run serve       # 起本地服务：一边看效果，一边自动重建
```
