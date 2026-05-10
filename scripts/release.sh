#!/bin/bash
set -e

# Fetch latest tags so we won't collide with remote-only ones
git fetch --tags --quiet 2>/dev/null || true

# Baseline = highest existing vX.Y.Z tag; fall back to package.json if none
LATEST_TAG=$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -n1)
if [ -n "$LATEST_TAG" ]; then
    CURRENT="${LATEST_TAG#v}"
else
    CURRENT=$(node -p "require('./package.json').version")
fi

bump() {
    node -p "
        const [maj, min, pat] = '$1'.split('.').map(Number);
        '$2' === 'major' ? (maj+1)+'.0.0' :
        '$2' === 'minor' ? maj+'.'+(min+1)+'.0' :
        maj+'.'+min+'.'+(pat+1)
    "
}

if [ -z "$1" ]; then
    BUMP_KIND="patch"
    NEW=$(bump "$CURRENT" "$BUMP_KIND")
elif [ "$1" = "major" ] || [ "$1" = "minor" ] || [ "$1" = "patch" ]; then
    BUMP_KIND="$1"
    NEW=$(bump "$CURRENT" "$BUMP_KIND")
else
    BUMP_KIND=""
    NEW="$1"
fi

# If the target tag already exists, keep bumping along the same axis until free.
# For an explicit version argument, fail loudly instead of silently picking another.
if [ -n "$BUMP_KIND" ]; then
    while git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; do
        NEW=$(bump "$NEW" "$BUMP_KIND")
    done
elif git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
    echo "错误: tag v$NEW 已存在" >&2
    exit 1
fi

echo "v$CURRENT -> v$NEW"

BRANCH=$(git branch --show-current)
[ "$BRANCH" != "main" ] && echo "错误: 请在 main 分支执行" && exit 1

git tag "v$NEW"
git push origin "v$NEW"

echo "已推送 v$NEW，Docker 构建触发中"
