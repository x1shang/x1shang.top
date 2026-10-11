---
title: 学术条目测试样例：一个不太严肃的小问题
date: 2026-10-11
authors: x1shang
venue: 测试样例（未投稿）
url: https://okmij.org/ftp/
summary: 用于检查学术板块的列表、详情页、公式渲染与热度排序。
tags: [测试样例, 学术]
heat: 2
test: true
---

## 问题

给定 $n$ 个点，问至少需要多少条边才能保证图连通。答案是

$$
\binom{n-1}{2} + 1 = \frac{(n-1)(n-2)}{2} + 1 .
$$

## 说明

这一条是**测试样例**，用来验证：

1. `content/papers/` 里的文件会自动出现在学术列表里；
2. 点击标题进入的是**简约阅读页**（单栏、无玻璃面板）；
3. 正文里的 LaTeX 会被 KaTeX 渲染；
4. front matter 里的 `heat: 2` 参与"先热度、后时间"排序。

删掉 `content/papers/2026-10-11-test-paper.md` 即可移除。
