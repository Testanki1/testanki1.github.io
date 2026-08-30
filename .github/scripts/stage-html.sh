#!/usr/bin/env bash
# 暂存所有改动过的 HTML 文件（.html / .htm）。
#
# 为什么不能直接 `git add -A '*.html' '*.htm'`：
#   git add 的 pathspec 如果匹配不到任何文件会直接 fatal 退出（exit 128），
#   而这个仓库里没有 .htm 文件，所以原写法必然失败。git status 不会报这个错，
#   容易让人误以为只有 add 这一步有问题。
#
# 这里先用 find 收集真实存在的文件，再交给 git add，没有匹配项也不会报错。
set -euo pipefail

mapfile -t FILES < <(
  find . -path '*/.git' -prune -o -type f \( -name '*.html' -o -name '*.htm' \) -print
)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "没有找到 HTML 文件，跳过暂存。"
  exit 0
fi

echo "暂存 ${#FILES[@]} 个 HTML 文件中被改动的部分"
git add -A -- "${FILES[@]}"
