# tools/ — 站点的工具与一次性脚本

这些脚本 2026-10-11 之前散落在工作区根目录的 `tools/` 里，**不在任何 git 仓库里**（坏了没法回退）。
现在全部并进 `x1shang` 仓库（总共约 73 KB），改坏了 `git checkout` 就能还原。

> 说明：其中几个脚本操作的是**另一个仓库**（工作区里的导航页 `../site`，部署在独立域名）。
> 之所以放在这儿，是因为工作区只有一个"运维仓库"，而 x1shang 就是它；每个脚本的默认路径都写死在
> 脚本里（用 `import.meta.url` / `$PSScriptRoot` 推），在哪里 clone 都能跑，必要时用 `SITE_DIR` 覆盖。

## 常用（长期有效）

| 脚本 | 作用 | 跑法 |
| --- | --- | --- |
| `serve.mjs` | 本地预览个人站：监听 `content/` `inbox/photos/` `assets/music/`，拖文件进去即重建并刷新 | `npm run serve` |
| `build-content.mjs` | 生成内容包 `content.auto.js` + `feed.xml` + `atom.xml` | `npm run build` / `npm run text` |
| `build-photos.py` | 照片流水线（Pillow）：EXIF 摆正、剥元数据、缩到 2000px、转 WebP + 缩略图 | `npm run photos` |
| `check.mjs` | 个人站自检：语法 / 内容包 / 页面引用 / 订阅源 / 纯静态性 / OG / robots / sitemap / stats | `npm run check` |
| `fetch-stats.mjs` | 抓访客量写 `stats.json`（关于页最下方那张图的数据源） | `npm run stats`（需 `GOATCOUNTER_SITE`，见脚本头注释） |
| `check-site.mjs` | 导航页上线前体检：内联 script 语法 + 本地引用是否存在 | `npm run check:site` |
| `check-layout.mjs` | 导航页磁贴排版校验（无重叠 / 不越界 / 铺满）：喂它一份 headless 导出的 DOM | `node tools/check-layout.mjs dump.html` |
| `build-index.mjs` | 扫目录生成导航页的 `site/all.html` 清单页（**不会**动手写的 `index.html`） | `npm run index` |
| `deploy-x1shang.ps1` | 个人站一键：重建 → 提交 → 推送（走本地代理 127.0.0.1:10809） | `npm run deploy` |

## 一次性 / 应急（已用过，留着以备重来）

| 脚本 | 什么时候用 |
| --- | --- |
| `gh-pages-setup.cjs` | 通过 API 开 Pages / 绑自定义域名（`GH_TOKEN=... node tools/gh-pages-setup.cjs`） |
| `enable-https.cjs` | 轮询证书签发、就绪后自动勾 Enforce HTTPS（`GH_TOKEN=... node tools/enable-https.cjs`）。**证书现在是 GitHub 自动签发 + 手动勾选，一般用不到它；真要它出手时它还在** |
| `dns-overseas-check.cjs` | 从"境外视角"（走本地代理 + DoT）查 `x1shang.top` / `www` 的解析，排查"只有境内能解析"这类线路问题 |

## 约定

- 新脚本丢进这个目录，并在上表登记；能挂到 `package.json` scripts 的就挂上。
- **不要**把一次性脚本、临时文件放回工作区根目录（根目录只留 `INDEX.md` / `todo.md` / `DEPLOY.md` 和站点目录）。
