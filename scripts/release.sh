#!/bin/bash
set -e

CURRENT=$(node -p "require('./package.json').version")

if [ -z "$1" ]; then
    NEW=$(node -p "const [m, i, p] = '$CURRENT'.split('.').map(Number); m+'.'+i+'.'+(p+1)")
elif [ "$1" = "major" ] || [ "$1" = "minor" ] || [ "$1" = "patch" ]; then
    NEW=$(node -p "
        const [maj, min, pat] = '$CURRENT'.split('.').map(Number);
        '$1' === 'major' ? (maj+1)+'.0.0' :
        '$1' === 'minor' ? maj+'.'+(min+1)+'.0' :
        maj+'.'+min+'.'+(pat+1)
    ")
else
    NEW="$1"
fi

echo "v$CURRENT -> v$NEW"

BRANCH=$(git branch --show-current)
[ "$BRANCH" != "main" ] && echo "错误: 请在 main 分支执行" && exit 1

git tag "v$NEW"
git push origin "v$NEW"

echo "已推送 v$NEW，Docker 构建触发中"
