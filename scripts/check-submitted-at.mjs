// PR 门禁校验：已存在稿件的 submittedAt（投稿日期）不允许被修改，
// 且任何稿件的投稿日期、发布日期均不允许晚于当前时间（预留 5 分钟时钟偏差）。
// 用法：node scripts/check-submitted-at.mjs <baseArchiveDir> <headArchiveDir>
// 不可变检查只比较两边都存在的条目（按 platform/owner/repo/slug 唯一键）；
// 未来时间检查覆盖 head 侧全部条目。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [baseDir, headDir] = process.argv.slice(2);
const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;

const load = (dir) => {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f))) {
    const { submissions } = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const s of submissions) map.set(entryKey(s), s);
  }
  return map;
};

const base = load(baseDir);
const head = load(headDir);
let violations = 0;

// 1. 投稿日期不可变（对已存在条目）
for (const [key, s] of head) {
  if (base.has(key) && base.get(key).submittedAt !== s.submittedAt) {
    console.error(`::error::投稿日期不允许修改: ${key} (${base.get(key).submittedAt} -> ${s.submittedAt})`);
    violations++;
  }
}

// 2. 投稿/发布日期均不允许晚于当前时间（预留 5 分钟时钟偏差）
const now = Date.now();
const TOLERANCE_MS = 5 * 60 * 1000;
const checkFuture = (key, field, value) => {
  if (value == null) return;
  const t = Date.parse(value);
  if (Number.isFinite(t) && t > now + TOLERANCE_MS) {
    console.error(`::error::${field} 不能超过当前时间: ${key} (${value})`);
    violations++;
  }
};
for (const [key, s] of head) {
  checkFuture(key, "投稿日期", s.submittedAt);
  checkFuture(key, "发布日期", s.publishedAt);
}

if (violations) process.exit(1);
console.log(`ok: submittedAt immutable across ${base.size} existing entries, no dates in the future`);
