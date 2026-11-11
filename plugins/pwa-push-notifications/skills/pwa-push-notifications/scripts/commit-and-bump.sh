#!/usr/bin/env bash
# commit-and-bump.sh — git hook that bumps the service worker's CACHE_VERSION
#
# Installed PWAs keep serving the cached app shell (and therefore the OLD
# chunk hashes) until the SW file itself changes and its `activate` handler
# evicts the old caches. Changing CACHE_VERSION is what triggers that
# eviction, so every commit that touches app code must bump it. This hook
# makes the bump automatic instead of something the author has to remember.
#
# Install as a post-commit hook:
#   cp scripts/commit-and-bump.sh .git/hooks/post-commit
#   chmod +x .git/hooks/post-commit
#
# Or wire it into husky:
#   # .husky/post-commit
#   bash scripts/commit-and-bump.sh
#
# Usage: bash scripts/commit-and-bump.sh [--sw public/sw.js]
#
# Only bumps when the staged change touches src/app/, src/components/,
# public/, or the SW file itself. Test files are ignored.

set -uo pipefail

SW_FILE="public/sw.js"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --sw) SW_FILE="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 0 ;;
    esac
done

CHANGED=$(git diff --cached --name-only | grep -E '^(src/app/|src/components/|public/)' | grep -v '\.test\.' || true)

if [[ -z "$CHANGED" ]]; then
    exit 0
fi

if [[ ! -f "$SW_FILE" ]]; then
    echo "[commit-and-bump] $SW_FILE not found — nothing to bump."
    exit 0
fi

CURRENT=$(sed -nE "s/.*CACHE_VERSION[[:space:]]*=[[:space:]]*['\"]([^'\"]*)['\"].*/\1/p" "$SW_FILE" | head -1)
if [[ -z "$CURRENT" ]]; then
    echo "[commit-and-bump] no CACHE_VERSION found in $SW_FILE — nothing to bump."
    exit 0
fi

# Increment a trailing number if there is one; otherwise append -1.
if [[ "$CURRENT" =~ ^(.*[^0-9])([0-9]+)$ ]]; then
    NEXT="${BASH_REMATCH[1]}$((10#${BASH_REMATCH[2]} + 1))"
else
    NEXT="${CURRENT}-1"
fi

sed -i.bak "s/${CURRENT}/${NEXT}/" "$SW_FILE"
rm -f "$SW_FILE.bak"
git add "$SW_FILE"

echo "[commit-and-bump] Bumped CACHE_VERSION: $CURRENT → $NEXT"
