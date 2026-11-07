#!/usr/bin/env bash
# Assembles the GitHub Pages site: the checked-out commit at the root, plus each open
# pull request from this repo under pr-<number>/. PR files are only copied, never run.
# Prints "<number> <sha>" for each preview it built. Needs `gh` (GH_TOKEN) and `git`.
#
#   scripts/build-pages.sh [out-dir]   # default: _site
set -euo pipefail

SITE_FILES=(index.html data variants vendor)
out="${1:-_site}"

rm -rf "$out"
mkdir -p "$out"
cp -R "${SITE_FILES[@]}" "$out/"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Fork PRs are skipped: their files would be served from the same origin as the main site.
gh pr list --state open --limit 200 --json number,isCrossRepository \
  --jq '.[] | select(.isCrossRepository | not) | .number' > "$tmp/prs"

while read -r num; do
  [ -n "$num" ] || continue
  if ! git fetch --quiet --no-tags --depth=1 origin "refs/pull/$num/head"; then
    echo "::warning::Couldn't fetch PR #$num; skipping its preview." >&2
    continue
  fi
  sha="$(git rev-parse FETCH_HEAD)"
  src="$tmp/pr-$num"
  mkdir -p "$src" "$out/pr-$num"
  git archive FETCH_HEAD | tar -x -C "$src"
  for f in "${SITE_FILES[@]}"; do
    if [ -e "$src/$f" ]; then cp -R "$src/$f" "$out/pr-$num/"; fi
  done
  echo "$num $sha"
done < "$tmp/prs"

# The Pages artifact follows symlinks, so a PR could otherwise publish files from the runner.
find "$out" -type l -delete
