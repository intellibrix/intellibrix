#!/usr/bin/env bash
# Scaffold a project with the built CLI and install it from locally packed tarballs, so the
# generated project can be tried before the packages are on npm.
# Usage: scripts/scaffold-local.sh <target-dir> [--skip-build]
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD

target=${1:-}
if [ -z "$target" ] || [ "${target#-}" != "$target" ]; then
  echo "usage: scripts/scaffold-local.sh <target-dir> [--skip-build]" >&2
  exit 2
fi
mkdir -p "$target"
target=$(cd "$target" && pwd)

if [ "${2:-}" != "--skip-build" ]; then
  pnpm -r build
fi

tarballs=$(mktemp -d)
trap 'rm -rf "$tarballs"' EXIT

# One override per package: the scaffold asks for ^1.0.0, and the tarballs carry the workspace
# versions, so the overrides point every @intellibrix dependency at its tarball instead.
overrides=""
for dir in packages/*; do
  name=$(jq -r .name "$dir/package.json")
  version=$(jq -r .version "$dir/package.json")
  (cd "$dir" && pnpm pack --pack-destination "$tarballs" >/dev/null)
  file="$tarballs/$(echo "${name#@}" | tr / -)-$version.tgz"
  overrides+="  \"$name\": \"file:$file\""$'\n'
done

node "$root/packages/cli/dist/bin.mjs" init "$target" --force
# pnpm 12 reads overrides from pnpm-workspace.yaml, not from package.json, and fails the install
# when a dependency's build script (esbuild, for tsx) is not approved.
printf 'allowBuilds:\n  esbuild: true\noverrides:\n%s' "$overrides" >"$target/pnpm-workspace.yaml"

# The tarballs are deleted on exit, so keep copies next to the project for later installs.
mkdir -p "$target/.local-tarballs"
cp "$tarballs"/*.tgz "$target/.local-tarballs/"
sed -i "s#file:$tarballs/#file:$target/.local-tarballs/#" "$target/pnpm-workspace.yaml"

(cd "$target" && pnpm install && pnpm typecheck)
echo
echo "Scaffold ready in $target"
echo "Run it with: cd $target && ANTHROPIC_API_KEY=... pnpm start"
