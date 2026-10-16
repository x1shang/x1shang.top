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
| `fetch-netease.mjs` | 网易云曲目：把 `assets/music/` 里 `netease: <歌曲ID>` 的条目抓成快照（标题/歌手/专辑/封面/LRC/有没有直链），缓存进 `tools/netease-cache.json`；`build-content.mjs` 会自动调用它 | `npm run netease`（= `--all --refresh`）或 `node tools/fetch-netease.mjs <ID>` |
| `import-netease-list.mjs` | 批量导入：把一份 `- [x] 歌名 歌手` 的 markdown 歌单清单，逐行匹配网易云 → 探测有没有直链 → 生成 `assets/music/*.md`（先 `--dry` 看匹配结果）。**推荐配 `--playlist <歌单ID>`**：先拉歌单再本地比对，精确且不受限流；不带则退回逐行搜索（网易云限流很凶）。带断点缓存 | `node tools/import-netease-list.mjs "<清单.md>" --playlist 6804342424 --dry` |
| `check-site.mjs` | 导航页上线前体检：内联 script 语法 + 本地引用是否存在 | `npm run check:site` |
| `check-layout.mjs` | 导航页磁贴排版校验（无重叠 / 不越界 / 铺满）：喂它一份 headless 导出的 DOM | `node tools/check-layout.mjs dump.html` |
| `build-index.mjs` | 扫目录生成导航页的 `site/all.html` 清单页（**不会**动手写的 `index.html`） | `npm run index` |
| `deploy-x1shang.ps1` | 个人站一键：重建 → 提交 → 推送（走本地代理 127.0.0.1:10809） | `npm run deploy` |
| `stat-worker/` | **自建统计的后端**（Phase 2）：一个 Cloudflare Worker（`/s.js` `/c` `/api/stats` `/api/export`）+ D1 表结构 + wrangler 配置。部署与验收步骤见它自己的 `README.md` | `cd tools/stat-worker; npx wrangler@latest deploy` |

## 一次性 / 应急（已用过，留着以备重来）

| 脚本 | 什么时候用 |
| --- | --- |
| `gh-pages-setup.cjs` | 通过 API 开 Pages / 绑自定义域名（`GH_TOKEN=... node tools/gh-pages-setup.cjs`） |
| `enable-https.cjs` | 轮询**某个** Pages 仓库的自定义域名证书、就绪后自动勾 Enforce HTTPS（`GH_TOKEN=... node tools/enable-https.cjs`；换目标：`$env:REPO='navigation-page'; $env:DOMAIN='navi.x1shang.top'; node tools/enable-https.cjs`）。**证书现在是 GitHub 自动签发 + 手动勾选，一般用不到它；真要它出手时它还在** |
| `recreate-pages.cjs` | **证书一直不签发的重锤**（health 全绿但 `https_certificate` 为 null 的卡死态）：用 API 删掉并重建 Pages 站点，逼 GitHub 重走「绑域名 → 申请证书」。⚠️ **站点会短暂下线 1~5 分钟**，所以按 ①`enable-https.cjs` 挂着等 ②去 Settings → Pages 点开一次 ③还不行再跑它 的顺序用。`$env:REPO='navigation-page'; $env:DOMAIN='navi.x1shang.top'; GH_TOKEN=…; node tools/recreate-pages.cjs`（2026-10-12 从工作区根目录那个不在版本管理里的 `tools/` 收编进来，顺手改成可换仓库） |
| `dns-overseas-check.cjs` | 从"境外视角"（走本地代理 + DoT）查 `x1shang.top` / `www` 的解析，排查"只有境内能解析"这类线路问题 |

## 约定

- 新脚本丢进这个目录，并在上表登记；能挂到 `package.json` scripts 的就挂上。
- **不要**把一次性脚本、临时文件放回工作区根目录（根目录只留 `INDEX.md` / `todo.md` / `DEPLOY.md` 和站点目录）。
