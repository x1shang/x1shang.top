# x1shang

以雪山与云海为首页的个人空间。**纯静态**：HTML / CSS / JavaScript，没有后端、没有打包步骤、没有 npm 依赖（构建只用 Node 内置模块 + Python 的 Pillow）。

预览：[首页索引](preview-home.webp) · [简约阅读页（含 KaTeX 公式）](preview-reading.webp) · [底部命令行检索](preview-search.webp) · [摄影板块](preview-photography.webp)

下拉之后的正文区仿 [okmij.org/ftp](https://okmij.org/ftp/) 的 Index：三栏密集链接索引、字体仍是站内的 Manrope、超链接用首页照片晴空的天蓝色（`#2f6fb5`，hover `#4a90d9`）；页面底色是云的颜色（近白微灰 `#f4f5f7`，条目不再铺渐变蓝）。**呈现文本的页面（文章 / 断言 / 论文正文）走简约阅读版式**：单栏、无玻璃面板、`72ch` 行宽。

## 目录结构

```
index.html style.css app.js render.js content.js   前端（render.js = Markdown/LaTeX/HTML 渲染器）
content.auto.js    自动生成的内容包（window.AUTO），会被提交
feed.xml atom.xml  自动生成的 RSS / Atom
robots.txt sitemap.xml  给爬虫的（sitemap 由构建生成，列出首页 + 每篇文字的真实路径）
articles/ assertions/ academic/   预渲染产物：每篇文字一个真实路径的静态页（构建生成，别手改）
stats.json         访客快照：日序列（关于页那张图）+ 按页总量（文章热度）
content/           文字投递箱：articles/ assertions/ papers/ friends/ + about.md
inbox/photos/      照片投递箱（gitignore，原始大图不进仓库，可建相册子目录）
assets/photos/     照片产物：压缩后的 WebP + manifest.json（提交）
assets/music/      音乐：音频 + 同名 .lrc 歌词 + 同名 .md/.json 元数据
assets/og-cover.jpg  分享卡片封面（1200×630，别改比例）
.github/workflows/  stats.yml：每天定时刷新 stats.json
tools/             serve / build-content / build-photos / check / fetch-stats + 运维脚本（详见 tools/README.md）
```

## 快速开始

```sh
npm run serve        # 本地预览：http://127.0.0.1:8080/
                     # 监听 content/ · inbox/photos/ · assets/music/，拖文件进来即重建并自动刷新
npm run build        # 只重建：内容包 + 照片流水线
npm run check        # 自检：语法 / 内容包 / 页面引用 / 订阅源 / 纯静态性 / 分享卡片 / robots / sitemap / stats
npm run stats        # 抓访客量写 stats.json（--demo 可先看图表长什么样；需要 GOATCOUNTER_SITE）
npm run check:site   # 顺带给导航页仓库做上线前体检（工具全在 tools/，见 tools/README.md）
```

直接双击 `index.html` 也能看（链接与照片都走相对路径，`file://` 下正常）；想用别的静态服务器也行，`python -m http.server 8080`。

## 发布流程（完整流程就这三步）

```sh
# 1) 丢文件（工作区 → 仓库文件夹，拖进去就行）
#    content/articles|assertions|papers|friends/*.md|.html|.tex|.txt
#    inbox/photos/*.jpg        ← 原图不入库，压缩后的 WebP 进 assets/photos/
#    assets/music/*.mp3        ← 同名 .lrc 自动当歌词
# 2) 重建
npm run build                  # = content.auto.js + feed/atom + sitemap + 预渲染页 + 照片流水线
# 3) 提交并推送（GitHub Pages 一分钟内自动刷新）
git add -A && git commit -m "更新内容" && git push
```

- 想边写边看：`npm run serve`（监听到丢文件会自动重建并刷新浏览器），它和 `npm run build` 做的事一样。
- 想一条命令走完：`npm run deploy`（= 完整重建 → 提交 → 推送到 `x1shang/x1shang.top`，走本地代理 `127.0.0.1:10809`）。
- **导航页（工作区里的另一个仓库 `site/`）不走这个流程**：手写单文件站，改完直接 `git add -A && git commit && git push`，没有构建步骤。
- **不用手动碰**这些构建产物：`content.auto.js`、`feed.xml`、`atom.xml`、`sitemap.xml`、`articles/`、`assertions/`、`academic/`、`assets/photos/`（手改会被下次 build 覆盖）。
- 访客数据（关于页的图 + 文章热度）是另一条线：`npm run stats`（或仓库 Secrets + `.github/workflows/stats.yml` 每天自动）→ 再 `npm run build` 才写进内容包。没配就是热度 0、图显示"数据还在积累"，不影响发布。

## 往里丢文件就行

| 目录 | 板块 | 扩展名 |
| --- | --- | --- |
| `content/articles/` | 文章 | `.md` `.html` `.tex` `.txt` |
| `content/assertions/` | 断言（一文件一则短句） | 同上 |
| `content/papers/` | 学术 | 同上 |
| `content/friends/` | 友链（写文件即显示） | `.md` |
| `content/about.md` | 关于页正文 | `.md` |
| `inbox/photos/` | 摄影 | jpg/png/webp/bmp/tif/avif… |
| `assets/music/` | 音乐 | mp3/wav/m4a/ogg/flac |

文件开头可写 `---` 元信息（`title` `date` `summary` `tags` `heat` `test` `draft` …），细节见 [content/README.md](content/README.md)；照片元数据见 [inbox/photos/README.md](inbox/photos/README.md)。

**排序**：先热度后时间。文章 / 断言 / 论文的热度 = **该页访客总量**（来自 `stats.json` 的 `pages` 表，构建期写进内容包的 `heat`，不联网）；照片 / 音乐 / 友链仍用 front matter 的 `heat`（照片是 sidecar 的 `heat`）。没有访客数据时热度一律 0，排序自然退化成按时间倒序。`heat` 只用于排序，页面上不显示。

## 渲染

- `.md` → Markdown（GFM 子集：标题/列表/任务列表/表格/代码块/引用/图片/自动链接），可混写 HTML 与 `$公式$`
- `.html` → 原始 HTML（照原样渲染，但会清掉 `<script>`/`<iframe>`/`on*=` 等）
- `.tex` → LaTeX 文档：剥掉导言区，`\section`/`\textbf`/`itemize` 等转成 HTML 结构，公式交给 KaTeX
- `.txt` → 等宽纯文本，保留缩进
- 数学：KaTeX 按 **jsdelivr → unpkg → bootcdn** 依次懒加载（每个 3 秒超时，CSS 与 JS 同源），全部失败时原文仍然可见（`.math-fallback`），不会白屏

## 全站检索

页面底部常驻一条命令行（`> ` 开头）：按 `/` 或 `>` 聚焦，↑↓ 选择，Enter 打开，Esc 收起；检索范围包含标题、正文、摘要、标签、照片说明、音乐、友链。支持前缀过滤：`文章: 关键词`、`摄影: 山`、`music: 山`（中英文前缀与 `kind:` 都可以）。检索状态会写进地址栏（`#search/关键词`），可分享。

## 音乐（含网易云评估）

自己放文件最省心：音频丢进 `assets/music/`，同名 `.lrc` 自动当歌词（播放器支持切歌、进度拖动、歌词同步滚动、刷新后重新播放）。

关于「从网易云导入歌单」，实测结论（2026-10-11 在本机验证）：

| 能力 | 结论 |
| --- | --- |
| 歌单元数据（曲目 / 歌手 / 专辑 / 封面） | ✅ 公开歌单可用：`music.163.com/api/v6/playlist/detail?id=<歌单ID>` 返回 200 JSON，无需登录；可以做成构建时快照 |
| 歌词 | ✅ 可用：`music.163.com/api/song/lyric?id=<歌曲ID>&lv=1&kv=1&tv=-1` 返回 200 LRC；但它没有 CORS 头，**只能构建时抓**，不能在浏览器里实时取 |
| 音频直链播放 | ❌ 已失效：`music.163.com/song/media/outer/url?id=<ID>.mp3` 现在 302 到 `music.163.com/404`（返回 107 KB 的 HTML 错误页），参考系（我站）与空 Referer 都一样；VIP / 独家曲目本来也不给直链 |
| 官方外链播放器 | ⚠️ 可用但不理想：`music.163.com/outchain/player?type=2&id=<ID>&auto=0&height=66` 返回 200，可以 iframe 嵌进静态页播放，但播放发生在网易云自己的 iframe 里——**拿不到播放进度，所以自己的歌词同步、进度条、切歌都用不了**，且 VIP 曲目只能试听 |

所以：想要"我们这套播放器 + 同步歌词"的体验，请把音频文件给我（丢进 `assets/music/` 即可）；如果你接受"每首一个网易云官方小播放器 + 静态歌词（不同步）"，告诉我歌单链接，我按歌单快照 + 官方 iframe 的方式接。

## 测试样例

每个板块都有一件带「测试样例」角标的样例，检查完删对应文件即可：

- 文章 4 篇（Markdown+LaTeX+HTML 混排 / 纯 HTML / `.tex` / 纯文本）
- 断言 2 则、学术 1 篇、友链 1 条
- 照片 2 张（`inbox/photos/test-sample-01.jpg` 带 sidecar；`inbox/photos/2026-test-album/test-sample-02.png` 验证相册与格式转换）
- 音乐 1 首（`assets/music/test-sample.wav` + `.lrc` + `.md`）

## 分享卡片 / 爬虫 / 访客统计（2026-10-11 加）

- **OG / Twitter Card**：写在 `index.html` 的静态 `<head>` 里（抓取方不执行 JS，靠 JS 注入没用），封面是 `assets/og-cover.jpg`（1200×630）。**每篇文章各自的卡片要等文章预渲染成真实路径** `/articles/<slug>/` 之后才能有 —— 哈希路由的 `#` 后面爬虫不看。
- **预渲染（每篇文字一个真实路径）**：每次 `npm run build` 都会重建 `articles/<id>/`、`assertions/<id>/`、`academic/<id>/` —— 拿 `index.html` 当模板，换掉 `<!-- build:head:* -->` 之间的头部（该页自己的标题 / description / canonical / OG）并把正文渲染进 `<main>`；相对引用自动补成 `../../`，所以 http 与本机双击 `file://` 都能打开。带着 JS 访问时 `app.js` 会接管同一个页面（URL 不跳转），没有 JS 或爬虫看到的则是静态正文。
- **`robots.txt` / `sitemap.xml`**：sitemap 由 `tools/build-content.mjs` 生成（首页 + 全部预渲染页），**别手改**。
- **关于页的访客统计图**：只读站内的 `stats.json`（访客的浏览器不会为这张图请求任何统计服务），数据由 `tools/fetch-stats.mjs` 从 GoatCounter 抓：

  ```sh
  $env:GOATCOUNTER_SITE='x1shang'; $env:GOATCOUNTER_TOKEN='...'; npm run stats
  node tools/fetch-stats.mjs --demo        # 没账号也想先看图表长什么样
  ```

  想长期自动刷新：把 `GOATCOUNTER_SITE` / `GOATCOUNTER_TOKEN` 加进仓库 Secrets，`.github/workflows/stats.yml` 每天跑一次并提交（GitHub 会在仓库连续 60 天无活动后暂停定时任务，随便 push 一次就恢复）。证书/token 这类要你亲自去后台做的事，记在根目录 `todo.md`。

  ⚠️ **国内网络注意**：GoatCounter 的静态资源在 `*.zgo.at` 上，而这个域在国内被 **DNS 污染**（`static.zgo.at` / `gc.zgo.at` 都解析不出来）。两个后果：
  1. 后台页面里 **Token 列的 `show` 按钮点了没反应**（那按钮靠 `static.zgo.at/backend.js`）——token 其实就写在 HTML 里：在该页按 `Ctrl+U` 查看源代码，搜 `data-show`，引号里那串就是。
  2. 官方文档给的计数脚本 `//gc.zgo.at/count.js` 在国内访客那里也加载不出来。所以本站 `index.html` 里用的是 **`//static.goatcounter.com/count.js`**（同一个脚本的可达镜像，2026-10-11 实测 200）；别再改回 `gc.zgo.at`。
- **Cloudflare Web Analytics**（可选，给自己看趋势、无 cookie）：`index.html` 末尾已插好官方 beacon，token 还是占位符 `REPLACE_WITH_CF_BEACON_TOKEN`，去 CF 后台 → Web Analytics → Add a site 建好再替换。

## 部署（GitHub Pages 等静态托管）

把仓库推上去即可，需要提交：`index.html` `style.css` `app.js` `render.js` `content.js` `content.auto.js` `feed.xml` `atom.xml` `robots.txt` `sitemap.xml` `stats.json` `articles/` `assertions/` `academic/` `content/` `assets/`（含 `assets/photos/*.webp` 与 `assets/og-cover.jpg`）。`inbox/` 不提交（已在 `.gitignore`）。

- 推之前先 `npm run build`，让 `content.auto.js` 带上最新文字与照片
- 路由用 `#`，放域名根或子目录都行，不需要重写规则

## 已知边界

- 照片：GIF/多帧图只取首帧；`.heic` 需要 Pillow 带 libheif（本机无）；`.avif` 取决于 Pillow 版本；原始照片目录不进仓库，换机器要重新投递原图
- 照片的 `id` 只跟源文件路径走（稳定），产物文件名带内容哈希（缓存失效），重新编码不影响排序
- 音乐播放需要由访客点击开始；外部音乐链接可能因跨域或防盗链无法播放
- KaTeX / Google Fonts 走 CDN，离线时分别回退到原始 TeX 文本与系统字体
