#!/usr/bin/env bash
# Lint every published package's exports and type resolution against its packed tarball.
# Requires a prior `pnpm -r build`.
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
for dir in packages/*; do
  echo "==> $dir"
  (cd "$dir" && publint --pack npm && attw --pack . --profile node16) || status=1
done
exit $status
