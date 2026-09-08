#!/bin/sh
# 镜像门禁：校验归档索引（schema + 投稿日期不可变），全部通过后
# 用 GitHub token 将本次推送的归档改动以 PR 形式提交到主索引仓。
# 环境变量：GITHUB_TOKEN（必填）、GITHUB_REPO、GITHUB_BASE、MIRROR_PLATFORM。
set -e

# 1. schema 校验
if ls index/archive/*.json >/dev/null 2>&1; then
  npx --yes ajv-cli validate -s schema/archive.schema.json \
    -r schema/submission.schema.json \
    -r schema/user.schema.json \
    -d "index/archive/*.json" --spec=draft7
else
  echo "no archive files, skip schema validation"
fi

# 2. 投稿日期不可变校验（与上一次提交对比；首推无基线则跳过）
prev=$(git rev-parse --verify -q HEAD~1 || true)
if [ -n "$prev" ]; then
  mkdir -p /tmp/svp-base
  git archive "$prev" -- index/archive | tar -x -C /tmp/svp-base
  node scripts/check-submitted-at.mjs /tmp/svp-base/index/archive index/archive
else
  echo "no previous commit, skip immutability check"
fi

# 3. 校验通过，向主索引仓提交 PR
node scripts/sync-to-github.mjs
