#!/bin/sh
# Builds the mock-backend app twice into $1: "a" with the repo's own
# companyConfig.js (empty reviewUrl, as shipped) and "b" with
# configs/demo-config-2.js (Gate 3 second business). Copies the working tree
# so the repo itself is never modified.
set -e
OUT="$1"; REPO="$(cd "$(dirname "$0")/../.." && pwd)"
for v in a b; do
  rm -rf "$OUT/src-$v"; mkdir -p "$OUT/src-$v"
  (cd "$REPO" && tar --exclude=node_modules --exclude=dist --exclude=.git -cf - .) | (cd "$OUT/src-$v" && tar -xf -)
  ln -s "$REPO/node_modules" "$OUT/src-$v/node_modules"
  [ "$v" = b ] && cp "$REPO/configs/demo-config-2.js" "$OUT/src-$v/companyConfig.js"
  (cd "$OUT/src-$v" && VITE_MOCK_BACKEND=1 npx vite build --outDir "$OUT/dist-$v" --emptyOutDir >/dev/null 2>&1)
  echo "built $v -> $OUT/dist-$v"
done
