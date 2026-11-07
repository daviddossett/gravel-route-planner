#!/usr/bin/env bash
# Keeps one "Preview" comment per pull request up to date after a Pages deploy.
#
#   scripts/comment-previews.sh <site-url> <previews-file> [closed-pr-number]
#
# <previews-file> is the output of build-pages.sh ("<number> <sha>" per line). A comment
# is only edited when its text changes. For a closed PR, an existing comment is marked removed.
# Needs `gh` with GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail

site_url="${1%/}"
previews="$2"
closed="${3:-}"
marker="<!-- pages-preview -->"

upsert() {
  local num="$1" body="$2" create="$3" id
  id="$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$num/comments" \
    --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" | sed -n 1p)"
  if [ -z "$id" ]; then
    if [ "$create" = yes ]; then gh api --silent "repos/$GITHUB_REPOSITORY/issues/$num/comments" -f body="$body"; fi
    return
  fi
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/issues/comments/$id" --jq .body)" != "$body" ]; then
    gh api --silent -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body"
  fi
}

while read -r num sha; do
  [ -n "$num" ] || continue
  url="$site_url/pr-$num/variants/atlas/"
  upsert "$num" "$marker
**Preview:** $url

Deployed from $sha. It updates on every push to this pull request and is removed when the pull request closes." yes
done < "$previews"

if [ -n "$closed" ]; then
  upsert "$closed" "$marker
**Preview removed.** This pull request is closed." no
fi
