/* 自动生成，请勿手改：由 tools/build-content.mjs 扫描 content/ 与 assets/ 产出。 */
window.AUTO = {
 "generated": "2026-10-11T07:55:51.757Z",
 "recent": "2026-10-11",
 "site": {
  "name": "x1shang",
  "url": "https://x1shang.top",
  "github": "x1shang",
  "since": "2026-10-11"
 },
 "articles": [
  {
   "id": "test-html",
   "date": "2026-10-11",
   "format": "html",
   "file": "content/articles/2026-10-11-test-html.html",
   "title": "纯 HTML 文章测试（测试样例）",
   "tags": [
    "测试样例",
    "HTML"
   ],
   "test": true,
   "heat": 0,
   "body": "\u003ch2>这是一段原始 HTML\u003c/h2>\n\u003cp>文件扩展名是 \u003ccode>.html\u003c/code>，正文不会被当成 Markdown 解析，而是按 HTML 原样渲染（\u003ccode>&lt;script&gt;\u003c/code>、\u003ccode>&lt;iframe&gt;\u003c/code> 之类会被清洗）。\u003c/p>\n\u003cfigure style=\"margin:18px 0\">\n  \u003cdiv style=\"display:grid;grid-template-columns:repeat(3,1fr);gap:10px\">\n    \u003cdiv style=\"height:70px;border-radius:8px;background:linear-gradient(135deg,#a7c0fa,#2f6fb5)\">\u003c/div>\n    \u003cdiv style=\"height:70px;border-radius:8px;background:linear-gradient(135deg,#dbe9f8,#7ea8d8)\">\u003c/div>\n    \u003cdiv style=\"height:70px;border-radius:8px;background:linear-gradient(135deg,#f4f8ff,#b9cdf2)\">\u003c/div>\n  \u003c/div>\n  \u003cfigcaption style=\"font-size:12px;color:#7b8d9f;margin-top:8px\">用 HTML 直接画的色块：检查者可以确认 HTML 通路是活的。\u003c/figcaption>\n\u003c/figure>\n\u003cp>文件里的公式同样可用：\u003cspan class=\"math-inline\">\\(a^2+b^2=c^2\\)\u003c/span>。\u003c/p>",
   "summary": "直接把 .html 文件丢进 content/articles/，整页照原样渲染。",
   "visits": 0
  },
  {
   "id": "test-markdown",
   "date": "2026-10-11",
   "format": "md",
   "file": "content/articles/2026-10-11-test-markdown.md",
   "title": "标记语言渲染测试（测试样例）",
   "tags": [
    "测试样例",
    "渲染",
    "Markdown"
   ],
   "test": true,
   "heat": 1,
   "body": "这一篇是**测试样例**：它故意把 Markdown、LaTeX、HTML 混在一起，用来检查渲染管线。删掉\n`content/articles/2026-10-11-test-markdown.md` 这篇文章就会消失。\n\n## 一、Markdown 基础\n\n**粗体**、*斜体*、~~删除线~~、行内代码 `const answer = 42`，以及一个[站外链接](https://okmij.org/ftp/)（样式参考的就是这一页的 Index）。\n\n无序列表：\n\n- 第一项\n- 第二项\n  - 嵌套项\n  - 另一个嵌套项\n- 第三项\n\n有序列表：\n\n1. 先做这个\n2. 再做那个\n3. 最后检查\n\n任务列表：\n\n- [x] 把文件拖进 `content/articles/`\n- [x] 让它出现在索引里\n- [ ] 检查完把自己的文章也丢进来\n\n> 引用块：排序 = 先热度（front matter 的 `heat`，作品用星数快照），后时间。\n\n表格：\n\n| 板块 | 投递目录 | 格式 |\n| --- | --- | --- |\n| 文章 | `content/articles/` | md / html / tex / txt |\n| 断言 | `content/assertions/` | 同上 |\n| 学术 | `content/papers/` | 同上 |\n| 照片 | `inbox/photos/`（gitignore） | jpg / png / webp / heic |\n| 音乐 | `assets/music/` | mp3 / wav / m4a / flac |\n\n代码块：\n\n```js\n// 代码块内容会被转义，不会被当成 HTML\nconst ridge = (x) => 606 - x * 0.2;\nconsole.log(`\u003c/script> 这种文本也不会破坏页面`);\n```\n\n## 二、LaTeX\n\n行内公式：质能方程 $E = mc^2$，求和 $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$，矩阵\n$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$。\n\n独立公式：\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,\\mathrm{d}x = \\sqrt{\\pi}\n$$\n\n$$\n\\hat{H}\\psi = -\\frac{\\hbar^2}{2m}\\nabla^2\\psi + V\\psi = E\\psi\n$$\n\n## 三、原始 HTML\n\n下面这段是直接写进 Markdown 的 HTML，应该照原样渲染：\n\n\u003cdiv style=\"border:1px solid #b9cdf2;border-radius:10px;padding:12px 14px;background:#f2f7ff\">\n  \u003cb>HTML 块\u003c/b>：可以放任意布局，\u003cmark>高亮\u003c/mark>、\u003ccode>代码\u003c/code>、自定义颜色都行。\n\u003c/div>\n\n\u003cdetails>\n  \u003csummary>点开看折叠内容\u003c/summary>\n  折叠里也是一段 HTML，用来验证 \u003ccode>&lt;details&gt;\u003c/code> 能正常用。\n\u003c/details>\n\n\u003cscript>window.__xss_probe = 1;\u003c/script>\n\u003cp>上面那行 \u003ccode>&lt;script&gt;\u003c/code> 会被清洗掉（打开控制台输入 \u003ccode>window.__xss_probe\u003c/code> 应该是 \u003ccode>undefined\u003c/code>）。\u003c/p>\n\n## 四、图片\n\n![首页那张雪山](assets/mountain.jpg)\n\n渲染到这里说明 Markdown、LaTeX、HTML、图片、代码块都通了。",
   "summary": "一页里同时验证 Markdown、LaTeX 与 HTML 的渲染效果，检查完删掉这个文件即可。",
   "visits": 1
  },
  {
   "id": "test-plain",
   "date": "2026-10-09",
   "format": "txt",
   "file": "content/articles/2026-10-11-test-plain.txt",
   "title": "纯文本文章测试（测试样例）",
   "tags": [
    "测试样例",
    "纯文本"
   ],
   "test": true,
   "heat": 0,
   "body": "纯文本段落之间用空行分开。\n\n    这一段前面留了四个空格，\n    应该保持等宽与缩进原样显示。\n\n    ascii art:\n      /\\    ___\n     /  \\  /   \\\n    /____\\/_____\\\n\n文件本身不会做 Markdown 解析，所以 **这里的星号不会被加粗**，\n$E=mc^2$ 也会原样显示成数学源码——这正是纯文本模式该有的样子。\n\n删掉 content/articles/2026-10-11-test-plain.txt 就能移除这篇。",
   "summary": ".txt 文件按等宽字体、保留换行地展示，不做 Markdown 解析。",
   "visits": 0
  },
  {
   "id": "test-latex",
   "date": "2026-10-08",
   "format": "tex",
   "file": "content/articles/2026-10-11-test-latex.tex",
   "title": "LaTeX 文件测试（测试样例）",
   "tags": [
    "测试样例",
    "LaTeX"
   ],
   "test": true,
   "heat": 0,
   "body": "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n\\section{一个最小例子}\n\n考虑 $n$ 个点的完全图，其边数为\n\\[\n\\binom{n}{2} = \\frac{n(n-1)}{2}.\n\\]\n\n\\subsection{为什么值得单独测}\n\n因为 \\textbf{LaTeX} 文件的正文里既有 \\emph{正文}，也有公式：\n\n\\[\n\\sum_{k=0}^{\\infty} \\frac{x^k}{k!} = e^{x}, \\qquad\n\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}.\n\\]\n\n\\end{document}",
   "summary": ".tex 文件会剥掉导言区，正文交给 KaTeX 排版。",
   "visits": 0
  }
 ],
 "assertions": [
  {
   "id": "test-assertion",
   "date": "2026-10-11",
   "format": "md",
   "file": "content/assertions/2026-10-11-test-assertion.md",
   "title": "",
   "tags": [
    "测试样例",
    "断言"
   ],
   "test": true,
   "heat": 0,
   "body": "断言（测试样例）：一个文件就是一则短句，正文可用 Markdown 与 $公式$。这一则在 front matter 里写了\n`heat: 3`，用来检查「先热度、后时间」的排序是否生效——它应该排在下面那则之前。",
   "visits": 0
  },
  {
   "id": "test-assertion-2",
   "date": "2026-10-10",
   "format": "md",
   "file": "content/assertions/2026-10-10-test-assertion-2.md",
   "title": "",
   "tags": [
    "测试样例"
   ],
   "test": true,
   "heat": 0,
   "body": "第二则断言（测试样例，没有写 heat）：热度为 0，所以应该排在上一则之后。\n断言也可以按 `#assertions/\u003cid>` 单独打开（检索结果就是这么跳的）。",
   "visits": 0
  }
 ],
 "papers": [
  {
   "id": "test-paper",
   "date": "2026-10-11",
   "format": "md",
   "file": "content/papers/2026-10-11-test-paper.md",
   "title": "学术条目测试样例：一个不太严肃的小问题",
   "tags": [
    "测试样例",
    "学术"
   ],
   "test": true,
   "heat": 0,
   "body": "## 问题\n\n给定 $n$ 个点，问至少需要多少条边才能保证图连通。答案是\n\n$$\n\\binom{n-1}{2} + 1 = \\frac{(n-1)(n-2)}{2} + 1 .\n$$\n\n## 说明\n\n这一条是**测试样例**，用来验证：\n\n1. `content/papers/` 里的文件会自动出现在学术列表里；\n2. 点击标题进入的是**简约阅读页**（单栏、无玻璃面板）；\n3. 正文里的 LaTeX 会被 KaTeX 渲染；\n4. front matter 里的 `heat: 2` 参与\"先热度、后时间\"排序。\n\n删掉 `content/papers/2026-10-11-test-paper.md` 即可移除。",
   "summary": "用于检查学术板块的列表、详情页、公式渲染与热度排序。",
   "authors": "x1shang",
   "venue": "测试样例（未投稿）",
   "url": "https://okmij.org/ftp/",
   "abstract": "问题",
   "visits": 0
  }
 ],
 "photos": [
  {
   "id": "photo-2026-test-album-test-sample-02",
   "src": "assets/photos/test-sample-02-7dbb45c6.webp",
   "thumb": "assets/photos/test-sample-02-7dbb45c6.thumb.webp",
   "title": "相册测试样例",
   "date": "2026-10-11",
   "location": "合成图 · 测试相册",
   "tags": [
    "测试样例",
    "合成图"
   ],
   "album": "2026-test-album",
   "caption": "这张是合成的 PNG（带透明通道），用来验证：PNG → WebP 转换、透明区合成白底、\n子目录当相册、以及 sidecar 元数据（标题 / 地点 / 标签）。",
   "width": 1920,
   "height": 1280,
   "bytes": 70164,
   "test": true,
   "heat": 0
  },
  {
   "id": "photo-test-sample-01",
   "src": "assets/photos/test-sample-01-5fb1ce84.webp",
   "thumb": "assets/photos/test-sample-01-5fb1ce84.thumb.webp",
   "title": "雪山测试样例",
   "date": "2026-10-11",
   "location": "川西 · 四姑娘山",
   "tags": [
    "测试样例",
    "风景",
    "雪山"
   ],
   "album": "",
   "caption": "这是照片测试样例：原始文件躺在 `inbox/photos/`（已 gitignore），\n页面上的 WebP 由流水线自动生成。",
   "width": 1607,
   "height": 1080,
   "bytes": 90148,
   "test": true,
   "heat": 4
  }
 ],
 "tracks": [
  {
   "id": "test-sample",
   "src": "assets/music/test-sample.wav",
   "title": "测试样例 · 四秒琶音",
   "artist": "x1shang（合成音，仅作检查用）",
   "date": "2026-10-11",
   "lyrics": "[00:00.00]（测试样例 · 四秒琶音）\r\n[00:00.80]第一个音落下\r\n[00:01.30]像雪线之上的风\r\n[00:02.00]第二个音跟着走\r\n[00:02.60]把想法轻轻托起\r\n[00:03.20]播放器、歌词、进度条都在工作\r\n",
   "tags": [
    "测试样例",
    "音乐"
   ],
   "test": true,
   "heat": 0,
   "netease": "",
   "bytes": 176444
  }
 ],
 "friends": [
  {
   "id": "test-friend",
   "date": "2026-10-11",
   "name": "测试友链 · navigation-page",
   "url": "https://github.com/x1shang/navigation-page",
   "description": "站长自己的导航磁贴首页（测试样例：友链写成文件就会显示）",
   "avatar": "",
   "status": "approved",
   "source": "file",
   "test": true,
   "tags": []
  }
 ],
 "about": "这个文件就是「关于」页的正文：编辑 `content/about.md` 即可，支持 Markdown 与 $LaTeX$。\n\n一个安静的个人空间，用来记录研究、创作和生活：文字丢进 `content/`，照片丢进 `inbox/photos/`，\n音乐丢进 `assets/music/`，跑一次构建就编入索引。\n\n整站是纯静态的：没有留言、点赞、在线申请，也没有后端；页面底部那条命令行检索在浏览器里跑。",
 "stats": {
  "articles": 4,
  "assertions": 2,
  "papers": 1,
  "photos": 2,
  "tracks": 1,
  "friends": 1
 }
};
