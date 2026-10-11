#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""照片自动压缩 / 转格式流水线（纯静态个人站专用）。

把投递箱里的原始照片（含多层子目录 / 相册）批量转成 WebP 主图 + 缩略图，
并生成供 Node 侧消费的 manifest.json 清单。

用法:
    python tools/build-photos.py [--inbox inbox/photos] [--out assets/photos]
        [--manifest assets/photos/manifest.json] [--max 2000] [--thumb 900]
        [--quality 82] [--force] [--json-stdout]

设计要点:
  * 相对路径按「当前工作目录」解析（调用方 cwd=x1shang，传相对路径）。
  * 幂等：清单里同一 source 的 sha256 未变且产物都在 → 跳过；--force 强制重做。
  * 剪枝：源文件被删除 → 清单条目与其产物一并删除。
  * src/thumb 保留调用时 --out 前缀原样（正斜杠），站内 <img src> 可直接用。
  * 不写 EXIF 到产物（顺带丢掉 GPS 等隐私信息）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

# --- 控制台编码兜底：Windows 管道下 cp936 装不下 ✅ / ⚠️ ---------------------
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - 极老环境
        pass

try:
    from PIL import Image, ImageOps
    from PIL import UnidentifiedImageError
except ImportError:  # 致命：没有 Pillow
    print("❌ 缺少 Pillow：本脚本依赖 Pillow（Pillow >= 9），请先安装再运行。", file=sys.stderr)
    raise SystemExit(1)

# --- 常量 -------------------------------------------------------------------

# 基础支持格式（Pillow 一定认得）
BASE_EXTS = {
    ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp",
    ".bmp", ".tif", ".tiff", ".gif",
}
# 可选格式：Pillow 注册了才纳入
OPTIONAL_EXTS = (".heic", ".heif", ".avif", ".avifs")
# 常见但本流水线不处理的图片类扩展名（出现时给出原因提示，而不是静默忽略）
UNSUPPORTED_HINT = {
    ".heic", ".heif", ".svg", ".raw", ".cr2", ".cr3", ".nef", ".arw", ".dng",
    ".orf", ".rw2", ".psd", ".eps", ".ai", ".tga", ".exr", ".hdr", ".jxl",
    ".mp4", ".mov", ".avi", ".mkv", ".webm",
}
# 大图阈值：超过就先 draft / 降采样，别把内存吃爆
BIG_PIXELS = 60_000_000
THUMB_QUALITY = 76
SIDECAR_EXTS = (".json", ".md", ".txt")   # 优先级：json > md > txt
META_KEYS = ("title", "date", "location", "tags", "album", "caption", "heat")
# 清单条目的固定键顺序（保证重复构建文本一致，方便 git diff）
CANON_KEYS = (
    "id", "source", "src", "thumb", "width", "height",
    "thumbWidth", "thumbHeight", "bytes", "sha256",
    "title", "date", "location", "tags", "album", "caption", "heat", "mtime",
)


# --- 小工具 -----------------------------------------------------------------

class _Parser(argparse.ArgumentParser):
    """参数错误也走退出码 1（默认 argparse 是 2）。"""

    def error(self, message: str):  # type: ignore[override]
        self.print_usage(sys.stderr)
        print(f"❌ 参数错误：{message}", file=sys.stderr)
        raise SystemExit(1)


def _positive_int(label: str):
    def _conv(raw: str) -> int:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            raise argparse.ArgumentTypeError(f"{label} 需要整数，收到 {raw!r}")
        if value <= 0:
            raise argparse.ArgumentTypeError(f"{label} 必须是正整数")
        return value

    return _conv


def _quality_int(raw: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"quality 需要整数，收到 {raw!r}")
    if not 1 <= value <= 100:
        raise argparse.ArgumentTypeError("quality 必须在 1..100 之间")
    return value


def warn(msg: str) -> None:
    """所有非致命提示都走 stderr，保证 --json-stdout 时 stdout 只有 JSON。"""
    print(f"⚠️  {msg}", file=sys.stderr)


def posix_prefix(raw: str) -> str:
    """--out / --inbox 前缀：只把反斜杠归一为正斜杠、去掉尾部斜杠，其余原样保留。"""
    s = str(raw).replace("\\", "/")
    while len(s) > 1 and s.endswith("/"):
        s = s[:-1]
    return s


def iso_utc(ts: float) -> str:
    """毫秒精度、Z 结尾的 UTC 时间串（与清单样例一致）。"""
    dt = datetime.fromtimestamp(ts, timezone.utc)
    return f"{dt:%Y-%m-%dT%H:%M:%S}.{dt.microsecond // 1000:03d}Z"


def now_iso() -> str:
    dt = datetime.now(timezone.utc)
    return f"{dt:%Y-%m-%dT%H:%M:%S}.{dt.microsecond // 1000:03d}Z"


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def make_slug(stem: str) -> str:
    """原文件主名 ASCII 化；纯中文名退化为 photo。"""
    s = stem.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "photo"


def stable_id(source: str) -> str:
    """照片的稳定 id：只跟【源文件路径】走，不含内容哈希。

    照片的点赞 / 留言按 id 记录，如果 id 里带内容哈希，重新压缩或换质量参数就会换 id，
    历史点赞会全部失联；所以这里用路径 slug，产物文件名仍然带哈希（用于缓存失效）。
    """
    stem = str(Path(source).with_suffix("")).replace("\\", "/")
    slug = make_slug(stem.replace("/", "-"))
    if slug == "photo":                       # 纯中文名退化成 photo 了：用路径哈希兜底
        slug = "photo-" + hashlib.sha1(source.encode("utf-8")).hexdigest()[:6]
    return f"photo-{slug}"


def supported_exts() -> set[str]:
    """基础格式 + Pillow 实际注册了的可选格式（heic / avif）。"""
    exts = set(BASE_EXTS)
    try:
        registered = {str(e).lower() for e in Image.registered_extensions()}
    except Exception:
        registered = set()
    for ext in OPTIONAL_EXTS:
        if ext in registered:
            exts.add(ext)
    return exts


def flatten_to_rgb(im: "Image.Image") -> "Image.Image":
    """带 alpha / 调色板透明的 → 合成到白底 RGB；其余直接 convert。"""
    if im.mode == "RGB":
        return im
    has_alpha = im.mode in ("RGBA", "LA", "PA") or (
        im.mode == "P" and "transparency" in im.info
    )
    if has_alpha:
        rgba = im.convert("RGBA")
        base = Image.new("RGB", rgba.size, (255, 255, 255))
        base.paste(rgba, mask=rgba.getchannel("A"))
        return base
    return im.convert("RGB")


def exif_date(im: "Image.Image") -> str | None:
    """EXIF DateTimeOriginal（其次 DateTimeDigitized / DateTime）→ YYYY-MM-DD。"""
    try:
        exif = im.getexif()
    except Exception:
        return None
    if not exif:
        return None
    candidates = []
    try:
        sub = exif.get_ifd(0x8769) or {}
        candidates += [sub.get(36867), sub.get(36868)]
    except Exception:
        pass
    candidates.append(exif.get(306))
    for raw in candidates:
        if not raw:
            continue
        m = re.match(r"(\d{4})[:/-](\d{2})[:/-](\d{2})", str(raw))
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def probe_exif_date(path: Path) -> str | None:
    """只为取 EXIF 拍摄日期而开图（只读文件头，不解码像素）。"""
    try:
        with Image.open(path) as im:
            return exif_date(im)
    except Exception:
        return None


def canonical(entry: dict) -> dict:
    """固定键顺序（未知键丢弃），保证重复构建的清单文本一致。"""
    return {k: entry[k] for k in CANON_KEYS if k in entry}


def norm_tags(value) -> list[str]:
    """tags 统一成字符串数组；支持 "a, b" / "[a, b]" / 列表。"""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        items = [str(v) for v in value]
    else:
        text = str(value).strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]
        items = text.replace("，", ",").split(",")
    out = []
    for item in items:
        s = str(item).strip().strip("'\"").strip()
        if s:
            out.append(s)
    return out


def norm_scalar(value) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        s = s[1:-1].strip()
    return s


def norm_date(value, fallback: str) -> str:
    s = norm_scalar(value)
    if not s:
        return fallback
    m = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return s


# --- sidecar 元数据 ---------------------------------------------------------

def parse_front_matter(text: str) -> tuple[dict, str]:
    """极简 YAML front matter：--- 包裹的 key: value；正文作为 caption。"""
    lines = text.splitlines()
    meta: dict = {}
    body = lines
    if lines and lines[0].strip() == "---":
        end = None
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                end = i
                break
        if end is not None:
            for line in lines[1:end]:
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                if ":" in line:
                    key, value = line.split(":", 1)
                    meta[key.strip().lower()] = value.strip()
            body = lines[end + 1:]
        else:  # 没有收尾的 ---：当作普通正文
            body = lines
    return meta, "\n".join(body).strip()


def read_sidecar(src_path: Path) -> dict:
    """读取同名 sidecar（.json 优先，其次 .md / .txt），返回归一化元数据。"""
    for ext in SIDECAR_EXTS:
        cand = src_path.with_suffix(ext)
        if not cand.is_file():
            continue
        try:
            raw = cand.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            warn(f"sidecar 读取失败：{cand.name}（{exc}）")
            continue
        if ext == ".json":
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                warn(f"sidecar JSON 解析失败：{cand.name}（{exc}）")
                continue
            if not isinstance(data, dict):
                warn(f"sidecar JSON 不是对象，忽略：{cand.name}")
                continue
            meta = {k: data[k] for k in META_KEYS if k in data}
        else:
            fm, body = parse_front_matter(raw)
            meta = {k: fm[k] for k in META_KEYS if k in fm}
            if body:
                meta["caption"] = body
        return meta
    return {}


# --- 编码 -------------------------------------------------------------------

def _atomic_save(im: "Image.Image", dest: Path, **kwargs) -> None:
    """先写同目录临时文件再 os.replace，避免产物半截。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(dest.parent), prefix=".tmp-build-photos-", suffix=".webp")
    os.close(fd)
    try:
        im.save(tmp, "WEBP", **kwargs)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def encode_images(
    src_path: Path,
    out_dir: Path,
    base_name: str,
    max_w: int,
    thumb_w: int,
    quality: int,
) -> dict:
    """打开 → 修正方向 → 合成白底 RGB → 缩到 max_w → 写主图与缩略图。"""
    with Image.open(src_path) as im0:
        # 超大图先让 JPEG 解码器降采样，避免一次性占满内存
        if im0.width * im0.height > BIG_PIXELS:
            try:
                im0.draft("RGB", (max_w, max_w))
            except Exception:
                pass
        im = ImageOps.exif_transpose(im0)
        date_hint = exif_date(im)
        im = flatten_to_rgb(im)
        if im.width > max_w:  # 只按宽度约束，绝不放大
            new_h = max(1, round(im.height * max_w / im.width))
            im = im.resize((max_w, new_h), Image.Resampling.LANCZOS)
        main_size = im.size

        main_path = out_dir / f"{base_name}.webp"
        _atomic_save(im, main_path, quality=quality, method=6)

        thumb = im.copy()
        thumb.thumbnail((thumb_w, 1 << 20), Image.Resampling.LANCZOS)
        thumb_size = thumb.size
        thumb_path = out_dir / f"{base_name}.thumb.webp"
        _atomic_save(thumb, thumb_path, quality=THUMB_QUALITY, method=6)

    return {
        "width": main_size[0],
        "height": main_size[1],
        "thumbWidth": thumb_size[0],
        "thumbHeight": thumb_size[1],
        "bytes": main_path.stat().st_size,
        "_date_hint": date_hint,
    }


# --- 清单 / 产物定位 --------------------------------------------------------

def product_path(stored: str, out_dir: Path) -> Path | None:
    """把清单里的 src/thumb 映射成「本次 --out 目录下的同名文件」。

    只在当前 --out 目录里找：若调用方换了 --out，旧产物不算数（否则会误判跳过、
    写出指向不存在文件的清单）。
    """
    name = PurePosixPath(str(stored).replace("\\", "/")).name
    if not name or name in (".", ".."):
        return None
    cand = out_dir / name
    return cand if cand.is_file() else None


def products_exist(entry: dict, out_dir: Path) -> bool:
    for key in ("src", "thumb"):
        stored = entry.get(key)
        if not stored or product_path(stored, out_dir) is None:
            return False
    return True


def delete_product(stored: str, out_dir: Path) -> bool:
    """剪枝时删产物：只删当前 --out 目录下的同名文件（保守，绝不越界）。"""
    name = PurePosixPath(str(stored).replace("\\", "/")).name
    if not name or name in (".", ".."):
        return False
    cand = out_dir / name
    try:
        if cand.is_file() and out_dir.resolve() == cand.resolve().parent:
            cand.unlink()
            return True
    except OSError as exc:
        warn(f"产物删除失败：{cand}（{exc}）")
    return False


def load_manifest(path: Path) -> dict[str, dict]:
    """旧清单 → {source: entry}；损坏则告警重建。"""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warn(f"清单无法解析（将重建）：{path}（{exc}）")
        return {}
    photos = data.get("photos") if isinstance(data, dict) else None
    if not isinstance(photos, list):
        warn(f"清单结构异常（将重建）：{path}")
        return {}
    old: dict[str, dict] = {}
    for item in photos:
        if isinstance(item, dict) and isinstance(item.get("source"), str):
            old[item["source"]] = item
    return old


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-manifest-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# --- 主流程 -----------------------------------------------------------------

def build_parser() -> _Parser:
    ap = _Parser(
        prog="build-photos.py",
        description="照片压缩 / 转 WebP 流水线（生成 manifest.json）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--inbox", default="inbox/photos", help="投递箱目录（默认 inbox/photos）")
    ap.add_argument("--out", default="assets/photos", help="产物目录（默认 assets/photos），其原样前缀会写进清单 src/thumb")
    ap.add_argument("--manifest", default="assets/photos/manifest.json", help="清单文件路径（默认 assets/photos/manifest.json）")
    ap.add_argument("--max", dest="max_w", type=_positive_int("--max"), default=2000, help="主图最大宽度（默认 2000，不放大）")
    ap.add_argument("--thumb", dest="thumb_w", type=_positive_int("--thumb"), default=900, help="缩略图最大宽度（默认 900，不放大）")
    ap.add_argument("--quality", type=_quality_int, default=82, help="主图 WebP 质量（默认 82）")
    ap.add_argument("--force", action="store_true", help="忽略清单缓存，强制重新编码")
    ap.add_argument("--json-stdout", action="store_true", help="把清单 JSON 打到 stdout（同时仍写清单文件）")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    inbox = Path(args.inbox)
    out_dir = Path(args.out)
    manifest_path = Path(args.manifest)
    out_prefix = posix_prefix(args.out)

    if not inbox.is_dir():
        print(
            f"❌ 投递箱不存在：{args.inbox}\n"
            f"   请先创建该目录并把原始照片放进去（相对路径按当前工作目录解析）。",
            file=sys.stderr,
        )
        return 1

    exts = supported_exts()
    old_map = load_manifest(manifest_path)

    # ---- 扫描：隐藏文件 / 隐藏目录 / 非图片忽略；不支持的图片扩展名提示 ----
    images: list[Path] = []
    hinted: list[str] = []
    for dirpath, dirnames, filenames in os.walk(inbox):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            path = Path(dirpath) / name
            ext = path.suffix.lower()
            if ext in exts:
                images.append(path)
            elif ext and ext in UNSUPPORTED_HINT and ext not in BASE_EXTS:
                hinted.append(path.relative_to(inbox).as_posix())
    for rel in hinted:
        warn(f"跳过（本流水线不处理的格式，扩展名 {Path(rel).suffix}）：{rel}")

    out_dir.mkdir(parents=True, exist_ok=True)

    entries: list[dict] = []
    processed = skipped = failed = pruned = 0
    seen: set[str] = set()
    used_ids: set[str] = set()

    for src_path in sorted(images, key=lambda p: p.relative_to(inbox).as_posix()):
        rel = src_path.relative_to(inbox)
        source = rel.as_posix()
        seen.add(source)
        prev = old_map.get(source)
        # 稳定 id（同源文件恒定；不同相册里同名文件自动加序号）
        pid = stable_id(source)
        n = 2
        while pid in used_ids:
            pid = f"{stable_id(source)}-{n}"
            n += 1
        used_ids.add(pid)
        try:
            stat = src_path.stat()
            digest = sha256_of(src_path)
        except OSError as exc:
            warn(f"源文件读取失败，跳过：{source}（{exc}）")
            failed += 1
            if prev:                      # 无法核验，保留旧条目更安全
                entries.append(prev)
            continue

        slug = make_slug(src_path.stem)
        hash8 = digest[:8]
        base_name = f"{slug}-{hash8}"
        src_out = f"{out_prefix}/{base_name}.webp"
        thumb_out = f"{out_prefix}/{base_name}.thumb.webp"

        # ---- 幂等：sha 未变且产物齐全 → 跳过（不重新编码，但元数据照常刷新）----
        if prev is not None and not args.force and prev.get("sha256") == digest and products_exist(prev, out_dir):
            entry = dict(prev)
            entry["id"] = pid
            entry["src"] = src_out
            entry["thumb"] = thumb_out
            entry["source"] = source
            entry["mtime"] = iso_utc(stat.st_mtime)
            for key in META_KEYS:
                entry.pop(key, None)
            entry.update(collect_meta(
                src_path, rel, stat.st_mtime,
                probe_exif_date(src_path), read_sidecar(src_path),
            ))
            entries.append(entry)
            skipped += 1
            continue

        # ---- 实际编码 ----
        try:
            info = encode_images(src_path, out_dir, base_name, args.max_w, args.thumb_w, args.quality)
        except (UnidentifiedImageError, OSError, ValueError, MemoryError) as exc:
            warn(f"无法处理，跳过：{source}（{type(exc).__name__}: {exc}）")
            failed += 1
            if prev:
                entries.append(prev)
            continue

        date_hint = info.pop("_date_hint", None)
        entry = {
            "id": pid,
            "source": source,
            "src": src_out,
            "thumb": thumb_out,
            "width": info["width"],
            "height": info["height"],
            "thumbWidth": info["thumbWidth"],
            "thumbHeight": info["thumbHeight"],
            "bytes": info["bytes"],
            "sha256": digest,
            "mtime": iso_utc(stat.st_mtime),
        }
        entry.update(collect_meta(src_path, rel, stat.st_mtime, date_hint, read_sidecar(src_path)))
        entries.append(entry)
        processed += 1

    # ---- 剪枝：清单里有、这次扫描没找到的源文件 → 删条目 + 删产物 ----
    for source, prev in old_map.items():
        if source in seen:
            continue
        removed = False
        for key in ("src", "thumb"):
            stored = prev.get(key)
            if isinstance(stored, str) and delete_product(stored, out_dir):
                removed = True
        pruned += 1
        warn(f"剪枝：源文件已删除 → {source}" + ("（产物已清理）" if removed else "（产物不存在）"))

    # ---- 固定键顺序 + 排序：date 降序，同日按 title 升序（构建可复现）----
    entries = [canonical(e) for e in entries]
    entries.sort(key=lambda e: (str(e.get("title", "")), str(e.get("source", ""))))
    entries.sort(key=lambda e: str(e.get("date", "")), reverse=True)

    doc = {
        "generated": now_iso(),
        "inbox": posix_prefix(args.inbox),
        "out": out_prefix,
        "photos": entries,
    }
    payload = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    try:
        write_text_atomic(manifest_path, payload)
    except OSError as exc:
        print(f"❌ 清单写入失败：{manifest_path}（{exc}）", file=sys.stderr)
        return 1

    summary = f"✅ 处理 {processed} 张 / 跳过 {skipped} 张 / 清理 {pruned} 条 → {args.manifest}"
    if failed:
        summary += f"（⚠️ 失败 {failed} 张）"

    if args.json_stdout:
        sys.stdout.write(payload)
        sys.stdout.flush()
        print(summary, file=sys.stderr)
    else:
        print(summary)
    return 0


def collect_meta(
    src_path: Path,
    rel: Path,
    mtime: float,
    date_hint: str | None,
    sidecar: dict,
) -> dict:
    """组装 title / date / location / tags / album / caption / heat（sidecar 优先）。"""
    parent = rel.parent.as_posix()
    location = "" if parent in (".", "") else parent
    album = rel.parts[0] if len(rel.parts) > 1 else ""

    title = norm_scalar(sidecar.get("title")) or src_path.stem
    fallback_date = date_hint or datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
    date = norm_date(sidecar.get("date"), fallback_date)
    meta_location = norm_scalar(sidecar.get("location"))
    if meta_location:
        location = meta_location
    tags = norm_tags(sidecar.get("tags"))
    meta_album = norm_scalar(sidecar.get("album"))
    if meta_album:
        album = meta_album
    caption = norm_scalar(sidecar.get("caption"))
    # heat：静态排序权重（sidecar 里写 heat: 或旧的 likes:），不显示在页面上
    try:
        heat = max(0, int(float(sidecar.get("heat") or sidecar.get("likes") or 0)))
    except (TypeError, ValueError):
        heat = 0
    return {
        "title": title,
        "date": date,
        "location": location,
        "tags": tags,
        "album": album,
        "caption": caption,
        "heat": heat,
    }


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("❌ 已中断", file=sys.stderr)
        raise SystemExit(1)
