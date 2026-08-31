// PR 门禁校验：已存在稿件的 submittedAt（投稿日期）不允许被修改。
// 用法：node scripts/check-submitted-at.mjs <baseArchiveDir> <headArchiveDir>
// 只比较两边都存在的条目（按 platform/owner/repo/slug 唯一键）；
// 新增条目、删除条目（由其他规则约束）不在本脚本职责内。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [baseDir, headDir] = process.argv.slice(2);
const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;

const load = (dir) => {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f))) {
    const { submissions } = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const s of submissions) map.set(entryKey(s), s.submittedAt);
  }
  return map;
};

const base = load(baseDir);
const head = load(headDir);
let violations = 0;
for (const [key, submittedAt] of head) {
  if (base.has(key) && base.get(key) !== submittedAt) {
    console.error(`::error::投稿日期不允许修改: ${key} (${base.get(key)} -> ${submittedAt})`);
    violations++;
  }
}
if (violations) process.exit(1);
console.log(`ok: submittedAt immutable across ${base.size} existing entries`);
