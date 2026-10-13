# x1shang

以雪山与云海为首页的个人空间。**纯静态**：HTML / CSS / JavaScript，没有后端、没有打包步骤、没有 npm 依赖（构建只用 Node 内置模块 + Python 的 Pillow）。

预览：[首页索引](preview-home.webp) · [简约阅读页（含 KaTeX 公式）](preview-reading.webp) · [底部命令行检索](preview-search.webp) · [摄影板块](preview-photography.webp)

下拉之后的正文区仿 [okmij.org/ftp](https://okmij.org/ftp/) 的 Index：按可用宽度自动切换 1–3 栏的均衡链接索引、字体仍是站内的 Manrope、超链接用首页照片晴空的天蓝色（`#2f6fb5`，hover `#4a90d9`）；页面底色是云的颜色（近白微灰 `#f4f5f7`，条目不再铺渐变蓝）。**呈现文本的页面（文章 / 断言 / 论文正文）走简约阅读版式**：单栏、无玻璃面板、`72ch` 行宽。

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
assets/music/      音乐：音频 + 同名 .lrc 歌词 + 同名 .md/.json 元数据；只写 netease: <歌曲ID> 的 .md = 网易云外链曲目（见下文「音乐」）
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
#    assets/music/*.md         ← 只写 netease: <歌曲ID>（没有同名音频）就是一首网易云外链曲目
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

**排序**：先热度后时间。文章 / 断言 / 论文的热度 = **该页访客总量**（来自 `stats.json` 的 `pages` 表，构建期写进内容包的 `heat`，不联网）；照片 / 音乐 / 友链仍用 front matter 的 `heat`（照片是 sidecar 的 `heat`）。没有访客数据时热度一律 0，排序自然退化成按时间倒序。**`test: true` 的测试样例永远排在所有列表最后**（2026-10-12 起，不受热度影响）。`heat` 只用于排序，页面上不显示。

## 渲染

- `.md` → Markdown（GFM 子集：标题/列表/任务列表/表格/代码块/引用/图片/自动链接），可混写 HTML 与 `$公式$`
- `.html` → 原始 HTML（照原样渲染，但会清掉 `<script>`/`<iframe>`/`on*=` 等）
- `.tex` → LaTeX 文档：剥掉导言区，`\section`/`\textbf`/`itemize` 等转成 HTML 结构，公式交给 KaTeX
- `.txt` → 等宽纯文本，保留缩进
- 数学：KaTeX 按 **jsdelivr → unpkg → bootcdn** 依次懒加载（每个 3 秒超时，CSS 与 JS 同源），全部失败时原文仍然可见（`.math-fallback`），不会白屏

## 全站检索

底栏默认是普通搜索，灰色 `>`；直接输入关键词，↑↓ 选择、Enter 打开。检索覆盖标题、正文、摘要、标签、照片说明、音乐与友链，支持 `文章: 关键词`、`摄影: 山`、`track: 关键词` 等类型过滤，搜索地址可分享。

点击 `>` 或按 `/` 进入命令模式，此时图标变蓝。输入 `help` 查看完整帮助；`ls` / `dir` / `Get-ChildItem` 列出内容，`open 3` 按编号打开，`cd..` 返回上级，`g h` 回主页、`g a` 到文章，`find` / `grep` / `Select-String` 搜索正文。还支持 `j/k`、`gg/G`、`goto`、`random`、历史命令与 Tab 补全。Esc 依次关闭照片、收起输出、退出命令模式。

底栏的月亮 / 太阳按钮切换主题；`theme` 切换、`theme dark` / `theme light` 指定主题，`theme system` 跟随系统。主题会自动记忆。暗色首页使用 @STAR素材(CC0) 星空与低饱和蓝色雪山合成，来源见 [图片说明](assets/milky-way-source.md)。

## 音乐（本地文件 + 网易云外链）

两种加法，想用哪种就用哪种：

**① 自己的音频**（最省心、最稳）：音频丢进 `assets/music/`，同名 `.lrc` 自动当歌词、同名 `.md`/`.json` 提供标题与作者。

**② 网易云曲目**（不用下载文件，加歌 = 写一行 ID）：
在 `assets/music/` 里放一个**没有同名音频**的 `.md`，front matter 里写歌曲 ID 就行：

```yaml
---
netease: 1809646618          # 歌曲链接里 song?id= 后面那串数字
date: 2026-10-12             # 可选；不写就用文件修改时间
tags: [音乐]                 # 可选
# title: / artist: / cover: / lyrics: 都可以手写，写了就盖掉抓来的值
# playable: false            # 想强制标成「无直链」时用
---
```

然后 `npm run build`（或 `npm run serve`）→ 构建期会自动抓标题 / 歌手 / 专辑 / 封面 / LRC 歌词，
缓存进 `tools/netease-cache.json`（**进仓库**，所以离线、以及在海外机器上跑的 GitHub Actions 也能重建出一样的结果）。
重新探测直链 / 刷新缓存：`npm run netease`。整站**仍然是纯静态**：没有任何接口、没有任何代理服务器。

**③ 批量导入**（手上有一份歌单清单时）：
`node tools/import-netease-list.mjs "<清单.md>" --playlist <歌单ID> --dry` —— 清单就是 `- [x] 歌名 歌手` 那种表
（`- [ ]` 视为不要、标了「本地」的跳过）。给了歌单 ID 就**先拉一次歌单**拿到每首歌的 ID/歌名/歌手，
再在本地跟清单逐行比对（比按名字搜准得多，也不吃搜索接口的限流）；不给歌单 ID 就退回搜索匹配。
确认无误去掉 `--dry` 真写，加 `--extra` 还能把歌单里清单没写到的可播曲目一并导进来。

### 网易云接入的实测结论（2026-10-12 复核，推翻第 5 轮的旧结论）

第 5 轮记的「音频直链已失效」是**误判**：当时大概拿到的是周杰伦这类没有版权的歌（`song?id=186016` 正好 302 到
`music.163.com/404`，返回 107 KB 的 HTML 错误页），于是把"这首歌没直链"当成了"这个接口坏了"。

| 能力 | 结论 | 怎么用 |
| --- | --- | --- |
| 歌曲元数据 | ✅ 公开接口、不用登录：`music.163.com/api/song/detail/?id=<ID>&ids=[<ID>]` 返回 200 JSON（歌名 / 歌手 / 专辑 / 封面 picUrl）；**没有 CORS 头**，浏览器里 fetch 会被拦 | 构建期抓，`tools/fetch-netease.mjs` |
| 歌词 | ✅ `music.163.com/api/song/lyric?id=<ID>&lv=-1&kv=-1&tv=-1` 返回 200 LRC；同样**没有 CORS 头** | 构建期抓，同上 |
| 音频直链播放 | ✅ **能用**（前提是这首歌网易云自己有版权）：`music.163.com/song/media/outer/url?id=<ID>.mp3` → 302 → CDN `m7xx.music.126.net/...mp3`，支持 Range（可拖动进度）。VIP / 独家 / 无版权曲目才会 302 到 `/404` | `<audio src="…outer/url…">` 直接用；播放不需要 CORS |
| http 跳转会不会被拦 | ✅ 不会：302 的目标虽然是 `http://`，但浏览器会把 https 页面里的这类"被动混合内容"**自动升级成 https** 再请求（本机在 https 页面上实测：`REQ -> https://m801.music.126.net/…`，`206`，正常出声）。构建期探测与运行时都不需要特殊处理 | — |
| 歌单元数据 | ✅ `music.163.com/api/v6/playlist/detail?id=<歌单ID>` 返回 200 JSON，无需登录，可做构建时快照 | 暂时没做，需要就说 |
| 官方外链播放器 | ⚠️ 可用但不理想：`music.163.com/outchain/player?type=2&id=<ID>&auto=0&height=66` 能 iframe 嵌入，但播放发生在网易云自己的 iframe 里，**拿不到进度**，自己的进度条 / 歌词同步 / 切歌都用不了 | 不用 |

已知限制（写在这里免得以后当成 bug）：

- **只有非 VIP 曲目有直链**。VIP / 独家 / 无版权（例如周杰伦整条线）网易云不签发直链，构建期会标记，
  列表里显示「网易云 · 无直链（VIP / 独家 / 无版权）」，点它不会假装能播。
- 直链的签名参数（`vuutv=`）每次请求都会变、**可能会过期**，所以站点**不缓存直链**，每次播放都重新走一次外链接口拿新的。
- 封面图是网易云 CDN 上的原图（可能 1 MB 上下），只在播放器里按需加载当前这一首。
- 海外访客、以及网易云改接口都可能让外链失效；真要"永远能听"，还是把音频文件放进 `assets/music/`。

## 测试样例

每个板块都有一件带「测试样例」角标的样例，检查完删对应文件即可：

- 文章 4 篇（Markdown+LaTeX+HTML 混排 / 纯 HTML / `.tex` / 纯文本）
- 断言 2 则、学术 1 篇、友链 1 条
- 照片 2 张（`inbox/photos/test-sample-01.jpg` 带 sidecar；`inbox/photos/2026-test-album/test-sample-02.png` 验证相册与格式转换）
- 音乐 0 首（原来的 `test-sample.wav/.lrc/.md` 与 `test-netease.md` 两个音乐样例 **2026-10-12 已删**；`assets/music/` 里现在都是真歌）

> 注意 `assets/music/` 里现在都是**真歌**：`我喜欢的音乐` 歌单导进来的 51 首（一行 `netease: <ID>` 的 .md）
> 加 5 首本地音频（`夏目.mp3` / `life.mp3` / `灯火里的中国.mp3` / `波斯序曲.mp3` / `帕格尼尼随想曲_第24号.mp3`）。
> 本地那几首是用户在 `E:\SJTU2026\threebody\gay\` 放的 wav/flac，用 ffmpeg 转成 VBR mp3 进仓库
> （原文件 82/57/42/13.5 MB → 9.5/5.5/5.1/4.1 MB，原始 wav/flac 没进仓库）。

## 分享（国内社媒）

文章与论文的详情页**最下方**有一个「复制标题与链接」按钮：点一下把 `标题 + 换行 + 真实路径链接`
写进剪贴板（正文里那句提示写在按钮旁边），按钮短暂变成「已复制 ✓」。

- 为什么不做"分享到微博/微信"：国内平台基本不读 OG 卡片，硬跳分享页反而更麻烦；复制粘贴最通用。
- 链接用的是 `content.js` 里 `site.url` + 预渲染的真实路径（`/articles/<id>/`、`/academic/<id>/`），
  所以分享出去的是爬虫也认的地址，不是 `#` 哈希路由。
- 实现：`app.js` 的 `shareBar()` + `render()` 末尾挂载（**站内 SPA 与预渲染页都会出现**，因为预渲染页也被 `app.js` 接管）；
  复制优先用 `navigator.clipboard`（https/localhost 才有），失败退回 `textarea + execCommand`，`http` 与 `file://` 双击也能用。
- 断言（`assertions`）暂时没加，要的话在 `render()` 那一行的判断里加上 `currentPage === 'assertions'` 即可。

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
- **Cloudflare Web Analytics：已删除（2026-10-12 决定）**。原来 `index.html` 末尾插着官方 beacon 但 token 一直是占位符，等于一个发无效请求的死脚本；既然 GoatCounter 已经同时管着「关于页访客图 + 文章热度」，就不再另养一套。将来想启用：CF 后台 → Web Analytics → Add a site（hostname 填 `x1shang.top`）→ 取 token，把官方 `<script src=".../beacon.min.js" data-cf-beacon='{"token":"…"}'>` 贴回 `</body>` 前即可。

- **访客图怎么刷新**：`.github/workflows/stats.yml` 每天 03:17 UTC 用仓库 Secrets（`GOATCOUNTER_SITE` / `GOATCOUNTER_TOKEN`）跑一次
  `fetch-stats.mjs` → 重建 `content.auto.js` → 有变化才提交。**本地没 token 是刷不出来的**：
  2026-10-12 实测，不带 token 走公开计数端点会全部返回 0（还会把 `stats.json` 里已有的真实数据刷没）。
  所以 `fetch-stats.mjs` 现在有护栏：这种模式下若新数据全空而旧数据非空，**拒绝写入**并提示（真要清零加 `--force`）。

## 部署（GitHub Pages 等静态托管）

把仓库推上去即可，需要提交：`index.html` `style.css` `app.js` `render.js` `content.js` `content.auto.js` `feed.xml` `atom.xml` `robots.txt` `sitemap.xml` `stats.json` `articles/` `assertions/` `academic/` `content/` `assets/`（含 `assets/photos/*.webp` 与 `assets/og-cover.jpg`）。`inbox/` 不提交（已在 `.gitignore`）。

- 推之前先 `npm run build`，让 `content.auto.js` 带上最新文字与照片
- 路由用 `#`，放域名根或子目录都行，不需要重写规则

## 已知边界

- 照片：GIF/多帧图只取首帧；`.heic` 需要 Pillow 带 libheif（本机无）；`.avif` 取决于 Pillow 版本；原始照片目录不进仓库，换机器要重新投递原图
- 照片的 `id` 只跟源文件路径走（稳定），产物文件名带内容哈希（缓存失效），重新编码不影响排序
- 音乐播放需要由访客点击开始；本地音频与网易云外链都是浏览器直接取，站点本身不代理任何流量。网易云只对**非 VIP / 非独家**曲目签发直链（构建期会探测并标注），且接口随时可能变
- KaTeX / Google Fonts 走 CDN，离线时分别回退到原始 TeX 文本与系统字体

### 首页与 tips

Index 各内容板块按原排序最多显示前 100 条，栏目页与全站搜索保留全部内容。动态保留最近三条。

底栏右侧 tips 来自仓库根目录 `tips.json`（字符串数组）。每次 `npm run text` / `npm run build` 都会读取并打包；预览服务也监听它。每次打开页面随机显示一条，每 30 秒随机切换，避免连续重复。填写 `[]` 可清空。

音乐的同步歌词显示在当前播放歌曲下方，切歌后随之移动。
