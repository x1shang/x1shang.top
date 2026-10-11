---
title: 标记语言渲染测试（测试样例）
date: 2026-10-11
summary: 一页里同时验证 Markdown、LaTeX 与 HTML 的渲染效果，检查完删掉这个文件即可。
tags: [测试样例, 渲染, Markdown]
heat: 5
test: true
---

这一篇是**测试样例**：它故意把 Markdown、LaTeX、HTML 混在一起，用来检查渲染管线。删掉
`content/articles/2026-10-11-test-markdown.md` 这篇文章就会消失。

## 一、Markdown 基础

**粗体**、*斜体*、~~删除线~~、行内代码 `const answer = 42`，以及一个[站外链接](https://okmij.org/ftp/)（样式参考的就是这一页的 Index）。

无序列表：

- 第一项
- 第二项
  - 嵌套项
  - 另一个嵌套项
- 第三项

有序列表：

1. 先做这个
2. 再做那个
3. 最后检查

任务列表：

- [x] 把文件拖进 `content/articles/`
- [x] 让它出现在索引里
- [ ] 检查完把自己的文章也丢进来

> 引用块：排序 = 先热度（front matter 的 `heat`，作品用星数快照），后时间。

表格：

| 板块 | 投递目录 | 格式 |
| --- | --- | --- |
| 文章 | `content/articles/` | md / html / tex / txt |
| 断言 | `content/assertions/` | 同上 |
| 学术 | `content/papers/` | 同上 |
| 照片 | `inbox/photos/`（gitignore） | jpg / png / webp / heic |
| 音乐 | `assets/music/` | mp3 / wav / m4a / flac |

代码块：

```js
// 代码块内容会被转义，不会被当成 HTML
const ridge = (x) => 606 - x * 0.2;
console.log(`</script> 这种文本也不会破坏页面`);
```

## 二、LaTeX

行内公式：质能方程 $E = mc^2$，求和 $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$，矩阵
$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$。

独立公式：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}
$$

$$
\hat{H}\psi = -\frac{\hbar^2}{2m}\nabla^2\psi + V\psi = E\psi
$$

## 三、原始 HTML

下面这段是直接写进 Markdown 的 HTML，应该照原样渲染：

<div style="border:1px solid #b9cdf2;border-radius:10px;padding:12px 14px;background:#f2f7ff">
  <b>HTML 块</b>：可以放任意布局，<mark>高亮</mark>、<code>代码</code>、自定义颜色都行。
</div>

<details>
  <summary>点开看折叠内容</summary>
  折叠里也是一段 HTML，用来验证 <code>&lt;details&gt;</code> 能正常用。
</details>

<script>window.__xss_probe = 1;</script>
<p>上面那行 <code>&lt;script&gt;</code> 会被清洗掉（打开控制台输入 <code>window.__xss_probe</code> 应该是 <code>undefined</code>）。</p>

## 四、图片

![首页那张雪山](assets/mountain.jpg)

渲染到这里说明 Markdown、LaTeX、HTML、图片、代码块都通了。
