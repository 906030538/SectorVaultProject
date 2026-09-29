// PR 门禁校验：PR 用户名必须与被改动条目（新增/修改/删除）的 owner 一致。
// 只校验与当前门禁同平台的条目：跨平台条目经镜像同步由各自平台门禁把关，
// 其 PR 由镜像 bot 账号创建，用户名不可比。
// 用法：node scripts/check-pr-owner.mjs <baseArchiveDir> <headArchiveDir> <username> <platform>
// 输出：ownerMismatch=<n>（供门禁决定是否自动合入），违规明细打到 stderr。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [baseDir, headDir, username, platform] = process.argv.slice(2);
if (!username || !platform) {
  console.error("usage: check-pr-owner.mjs <baseArchiveDir> <headArchiveDir> <username> <platform>");
  process.exit(2);
}
const user = username.toLowerCase();

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

let mismatch = 0;
for (const key of new Set([...base.keys(), ...head.keys()])) {
  const before = base.get(key);
  const after = head.get(key);
  const touched =
    (before === undefined || after === undefined || JSON.stringify(before) !== JSON.stringify(after));
  if (!touched) continue;
  const entry = after ?? before; // 删除的条目取基线版本
  if (entry.platform !== platform) continue;
  if (entry.owner.toLowerCase() !== user) {
    console.error(
      `::error::条目 ${key} 的 owner 不是 PR 作者 ${username}，不能自动合入（请由 ${entry.owner} 本人提交或走管理员审核）`
    );
    mismatch++;
  }
}

console.log(`ownerMismatch=${mismatch}`);
process.exit(mismatch ? 1 : 0);
