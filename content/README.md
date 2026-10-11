# content/ —— 往里丢文件，页面自动加载

把文本文件拖进对应子目录，保存（本地服务运行时会自动重建并刷新页面），刷新后内容就出现在索引里。
文件名建议用 `YYYY-MM-DD-英文短名.md`，日期会被自动识别。

| 目录 | 板块 | 支持的扩展名 |
| --- | --- | --- |
| `content/articles/` | 文章 | `.md` `.markdown` `.html` `.htm` `.tex` `.latex` `.txt` |
| `content/assertions/` | 断言（一个文件一则短句） | 同上 |
| `content/papers/` | 学术（论文 / 研究记录） | 同上 |
| `content/friends/` | 友链（写文件即显示） | `.md` 为主 |
| `content/about.md` | 关于页正文 | `.md` |

## 文件头（可选，但很有用）

文件开头可以写一段 `---` 包起来的元信息，用来指定标题、日期、摘要、标签、"测试样例"标记和排序权重：

```md
---
title: 标题
date: 2026-10-11
summary: 列表页显示的一句话摘要
tags: [随笔, 逆向]
heat: 3           # 热度（纯静态排序权重：先 heat 大的，再按日期新的）
test: true        # 打上"测试样例"角标，方便检查完删除
draft: true       # 写了这行就完全不显示
---
```

- `heat` 只影响排序，不在页面上显示；不写就是 0（等于只按时间排）。旧字段名 `likes` 仍然兼容。
- 没写 `title` 时用文件名（去掉日期前缀）；没写 `date` 时用文件名里的日期，再不行用文件修改时间。
- 学术条目还支持 `authors` `venue` `url` `abstract`。
- 友链条目用 `name` `url` `description`。
- 扩展名决定渲染方式：`.md` → Markdown（可混 HTML 与 `$公式$`）、`.html` → 原始 HTML、
  `.tex` → LaTeX（自动剥掉导言区）、`.txt` → 等宽纯文本。

## 本目录里的测试样例

`articles/` 四篇、`assertions/` 两则、`papers/` 一篇、`friends/` 一条都标了 `test: true`，
页面上带「测试样例」角标。检查完直接删文件即可，不影响其它内容。
