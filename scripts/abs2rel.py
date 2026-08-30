#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
abs2rel.py — 把 HTML 里指向本站的绝对 URL 改写成相对路径。

    https://testanki1.github.io/logos/steam.svg   ->  ../logos/steam.svg   (在 /servers.html 里)
    https://testanki1.github.io/logos/steam.svg   ->  ./logos/steam.svg    (在 /index.html 里)
    https://testanki1.github.io/news.json?t=123   ->  ./news.json?t=123    (保留 query / hash)

设计要点
--------
1. 只改 host 匹配 `--host` 的 URL，其它域名（raw.githubusercontent.com 等）原样保留。
2. 只改「标签内部」和「<script> / <style> 内容」里的 URL；
   普通文本节点（页面上肉眼可见的文字）一律跳过，避免把展示用网址也改掉。
3. 相对路径按每个文件所在的目录深度计算（document-relative），
   所以把整站放到子目录、换域名、或在本地 file:// / 本地 http server 打开都能正常访问。
4. 幂等：已经是相对路径的文件再跑一次不会产生任何改动。

用法
----
    python3 scripts/abs2rel.py --root .                 # 就地改写
    python3 scripts/abs2rel.py --root . --check         # 只检查，有需要改的地方就 exit 1（CI 用）
    python3 scripts/abs2rel.py --root . --mode root     # 改写成根相对路径 /logos/steam.svg
    python3 scripts/abs2rel.py --root . --summary-file report.md
"""

from __future__ import annotations

import argparse
import posixpath
import re
import sys
from pathlib import Path
from typing import Iterable, NamedTuple

DEFAULT_HOST = "testanki1.github.io"
DEFAULT_EXT = (".html", ".htm")
SKIP_DIRS = {".git", "node_modules", ".github", "dist", "build", "out", ".venv", "vendor"}

# URL 里允许出现的字符：遇到空白、各种引号、尖括号、反斜杠、以及 ) ] 就认为 URL 结束。
# 注意保留 { } $ —— 否则 `https://host/${x}/` 这类模板字符串会被截断。
PATH_CHARS = r"[^\s\"'`<>\\)\]]"


class Replacement(NamedTuple):
    line: int
    old: str
    new: str


class Skipped(NamedTuple):
    line: int
    url: str
    reason: str


def build_url_regex(host: str) -> re.Pattern:
    """匹配 http(s)://host 或 //host，后面跟可选的路径。"""
    return re.compile(
        r"(?:https?:)?//"                 # 协议（可省略，protocol-relative）
        + re.escape(host) +
        r"(?![.\w-])"                     # 防止 testanki1.github.io.evil.com 这类误匹配
        r"(?P<path>/" + PATH_CHARS + r"*|/)?"
    )


def build_token_regex() -> re.Pattern:
    """把 HTML 切成：注释 / script 开闭标签 / style 开闭标签 / 普通标签。"""
    return re.compile(
        r"(?P<comment><!--.*?(?:-->|\Z))"
        r"|(?P<script_open><script\b[^>]*>)"
        r"|(?P<script_close></script\s*>)"
        r"|(?P<style_open><style\b[^>]*>)"
        r"|(?P<style_close></style\s*>)"
        r"|(?P<tag><[^>]*>)",
        re.S | re.I,
    )


def to_relative(target_path: str, src_dir: str, mode: str) -> str:
    """
    target_path : 绝对 URL 里 host 之后的部分，例如 '/logos/steam.svg'、'/stickers/'、'' 或 '/'
    src_dir     : 当前 HTML 文件相对站点根目录的目录名，例如 ''（根）或 'maps/special'
    mode        : 'relative' 文档相对路径（默认） | 'root' 根相对路径（/xxx）
    """
    if mode == "root":
        if not target_path:
            return "/"
        return target_path

    trailing = "/" if target_path.endswith("/") else ""
    t = target_path.lstrip("/")
    start = src_dir if src_dir else "."

    if not t:  # https://host 或 https://host/  ->  当前目录
        return "./"

    rel = posixpath.relpath(posixpath.normpath(t), start)
    if rel == ".":
        return "./"
    if not rel.startswith("."):
        rel = "./" + rel
    return rel + trailing


class Rewriter:
    def __init__(self, host: str, mode: str):
        self.url_re = build_url_regex(host)
        self.token_re = build_token_regex()
        self.mode = mode

    def rewrite_text(self, text: str, src_dir: str, base_line: int):
        """对一段『允许改写』的文本做替换，返回 (新文本, 替换列表)。"""
        replacements: list[Replacement] = []

        def sub(m: re.Match) -> str:
            path = m.group("path") or ""
            new = to_relative(path, src_dir, self.mode)
            if new == m.group(0):
                return m.group(0)
            line = base_line + text.count("\n", 0, m.start())
            replacements.append(Replacement(line, m.group(0), new))
            return new

        return self.url_re.sub(sub, text), replacements

    def process(self, source: str, src_dir: str):
        """扫描整个 HTML，返回 (新文本, 替换列表, 跳过列表)。"""
        out: list[str] = []
        replacements: list[Replacement] = []
        skipped: list[Skipped] = []

        pos = 0
        in_raw = False  # 是否在 <script> / <style> 内容里

        def handle(chunk: str, base_line: int, allowed: bool, reason: str):
            nonlocal replacements, skipped
            if not chunk:
                return chunk
            if allowed:
                new_chunk, reps = self.rewrite_text(chunk, src_dir, base_line)
                replacements.extend(reps)
                return new_chunk
            for m in self.url_re.finditer(chunk):
                skipped.append(
                    Skipped(base_line + chunk.count("\n", 0, m.start()), m.group(0), reason)
                )
            return chunk

        for m in self.token_re.finditer(source):
            gap = source[pos : m.start()]
            base_line = source.count("\n", 0, pos) + 1
            out.append(handle(gap, base_line, allowed=in_raw, reason="可见文本节点（保持原样）"))

            token = m.group(0)
            tok_line = base_line + gap.count("\n")
            kind = m.lastgroup

            if kind == "comment":
                # 注释里的内容不动，只报告
                for sm in self.url_re.finditer(token):
                    skipped.append(
                        Skipped(tok_line + token.count("\n", 0, sm.start()), sm.group(0), "HTML 注释")
                    )
                out.append(token)
            elif kind in ("script_open", "style_open"):
                new_tok, reps = self.rewrite_text(token, src_dir, tok_line)
                replacements.extend(reps)
                out.append(new_tok)
                in_raw = True
            elif kind in ("script_close", "style_close"):
                in_raw = False
                new_tok, reps = self.rewrite_text(token, src_dir, tok_line)
                replacements.extend(reps)
                out.append(new_tok)
            else:  # 普通标签：属性里的 src/href/content 等都可以改
                new_tok, reps = self.rewrite_text(token, src_dir, tok_line)
                replacements.extend(reps)
                out.append(new_tok)

            pos = m.end()

        tail = source[pos:]
        base_line = source.count("\n", 0, pos) + 1
        out.append(handle(tail, base_line, allowed=in_raw, reason="可见文本节点（保持原样）"))

        return "".join(out), replacements, skipped


def iter_html_files(root: Path, exts: Iterable[str], exclude: list[str]) -> list[Path]:
    exts = tuple(e.lower() for e in exts)
    files = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in exts:
            continue
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS or part in exclude for part in rel.parts):
            continue
        files.append(p)
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description="HTML 绝对 URL -> 相对路径")
    ap.add_argument("--root", default=".", help="站点根目录（仓库根目录），默认当前目录")
    ap.add_argument("--host", default=DEFAULT_HOST, help=f"要改写的域名，默认 {DEFAULT_HOST}")
    ap.add_argument("--mode", choices=["relative", "root"], default="relative",
                    help="relative=文档相对路径（默认）；root=根相对路径（/xxx）")
    ap.add_argument("--ext", default=",".join(DEFAULT_EXT), help="要处理的文件后缀，默认 .html,.htm")
    ap.add_argument("--exclude-dir", action="append", default=[], help="额外跳过的目录名，可重复")
    ap.add_argument("--check", action="store_true", help="只检查不改写；有改动需求时退出码为 1")
    ap.add_argument("--summary-file", help="把 Markdown 报告写到指定文件（可用于 $GITHUB_STEP_SUMMARY）")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"错误：{root} 不是目录", file=sys.stderr)
        return 2

    rewriter = Rewriter(args.host, args.mode)
    files = iter_html_files(root, [e for e in args.ext.split(",") if e], args.exclude_dir)

    changed: list[tuple[Path, list[Replacement], list[Skipped]]] = []
    total_reps = 0

    for f in files:
        try:
            source = f.read_text(encoding="utf-8", newline="")
        except (UnicodeDecodeError, OSError) as e:
            print(f"跳过 {f}: {e}", file=sys.stderr)
            continue

        src_dir = str(f.parent.relative_to(root)).replace("\\", "/")
        if src_dir == ".":
            src_dir = ""

        new_source, reps, skipped = rewriter.process(source, src_dir)
        if reps:
            changed.append((f, reps, skipped))
            total_reps += len(reps)
            if not args.check:
                f.write_text(new_source, encoding="utf-8", newline="")

    # ---- 控制台输出 ----
    verb = "将改写" if args.check else "已改写"
    print(f"扫描 HTML 文件：{len(files)} 个")
    print(f"{verb} URL：{total_reps} 处，涉及文件：{len(changed)} 个")
    for f, reps, skipped in changed:
        rel = f.relative_to(root)
        print(f"\n  {rel}  ({len(reps)} 处)")
        for r in reps:
            print(f"    L{r.line}: {r.old}  ->  {r.new}")
        for s in skipped:
            print(f"    L{s.line}: [跳过] {s.url}  ({s.reason})")

    if args.check and total_reps:
        print("\n检查未通过：存在可相对化的绝对 URL。")
        print("在本地执行 `python3 scripts/abs2rel.py --root .` 即可自动修复。")

    # ---- Markdown 报告 ----
    if args.summary_file:
        lines = [f"## 绝对 URL → 相对路径（{args.mode} 模式）", ""]
        lines.append(f"- 扫描 HTML 文件：**{len(files)}** 个")
        lines.append(f"- {verb} URL：**{total_reps}** 处，涉及 **{len(changed)}** 个文件")
        lines.append("")
        for f, reps, skipped in changed:
            rel = f.relative_to(root)
            lines.append(f"### `{rel}`")
            lines.append("")
            lines.append("| 行 | 原值 | 新值 |")
            lines.append("|---|---|---|")
            for r in reps:
                lines.append(f"| {r.line} | `{r.old}` | `{r.new}` |")
            lines.append("")
            for s in skipped:
                lines.append(f"> 跳过 L{s.line} `{s.url}` — {s.reason}")
            lines.append("")
        Path(args.summary_file).write_text("\n".join(lines), encoding="utf-8")

    return 1 if (args.check and total_reps) else 0


if __name__ == "__main__":
    sys.exit(main())
