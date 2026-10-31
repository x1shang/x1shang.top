---
title: 纯文本示例
nickname: x1shang
date: 2026-10-31
tags: [示例, 代码]
source: plain.py
ext: py
submission: 20261031-demo-0002
test: true
---

def greet(name: str) -> str:
    """纯文本展示：保留缩进与换行，不做语法高亮。"""
    return f"hello, {name}"


if __name__ == "__main__":
    print(greet("x1shang"))
