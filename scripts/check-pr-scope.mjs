// PR 门禁校验：判断 PR 是否可自动合并。
// 以下情况需要管理员审核（不自动合并）：
//   - 删除了任何文件；
//   - 修改的稿件条目数 > 1（新增 + 改动合计；正常投稿 PR 只涉及 1 条稿件）。
// 用法：node scripts/check-pr-scope.mjs <baseArchiveDir> <headArchiveDir> <baseTree> <headTree>
// 输出：decision=auto|review、changed=<n>、deleted=<n>（供 workflow 使用）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [baseDir, headDir, baseTree, headTree] = process.argv.slice(2);
const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;

const load = (dir) => {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f))) {
    const { submissions } = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const s of submissions) map.set(entryKey(s), JSON.stringify(s));
  }
  return map;
};

// 统计 PR 中删除的文件数
const deletedFiles = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=D", `${baseTree}...${headTree}`],
  { encoding: "utf8" }
).split("\n").filter(Boolean);

const base = load(baseDir);
const head = load(headDir);
let changed = 0;
for (const [key, val] of head) {
  if (!base.has(key) || base.get(key) !== val) changed++;
}

const decision = deletedFiles.length > 0 || changed > 1 ? "review" : "auto";
console.log(`decision=${decision}`);
console.log(`changed=${changed}`);
console.log(`deleted=${deletedFiles.length}${deletedFiles.length ? ` (${deletedFiles.join(", ")})` : ""}`);
