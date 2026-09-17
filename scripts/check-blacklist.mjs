// 黑名单校验：按 blacklist.json 的规则检查 git 提交与索引条目中的作者/邮箱。
// 每条规则包含 name / email 两个可选正则（至少其一）；
// 规则命中条件为「提供的正则全部匹配」（AND）：
//   - 同时提供 name+email：精确封锁某个身份对；
//   - 只提供 email：封锁任意使用该邮箱的作者；
// 正则为 JavaScript RegExp（u 标志、非锚定，用 ^ $ 控制精确匹配）。
// 用法：node scripts/check-blacklist.mjs <baseRev|-> <headRev>
//   baseRev 为 "-" 时跳过 git 提交检查（只检查索引条目）。
// 检查对象：
//   1. git 提交：git log baseRev..headRev 每个提交的作者名与邮箱；
//   2. 索引条目：head 工作区 index/archive/*.json 中每条稿件的 author/email。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [baseRev, headRev] = process.argv.slice(2);
if (!headRev) {
  console.error("usage: check-blacklist.mjs <baseRev|-> <headRev>");
  process.exit(2);
}

// 载入并编译规则；黑名单文件缺失视为无规则，配置损坏则 fail closed
let rules = [];
const blacklistPath = join(root, "blacklist.json");
if (existsSync(blacklistPath)) {
  const { rules: raw } = JSON.parse(readFileSync(blacklistPath, "utf8"));
  rules = raw.map(({ name, email }) => ({
    name: name ? new RegExp(name, "u") : null,
    email: email ? new RegExp(email, "u") : null,
  }));
}

const describe = ({ name, email }) =>
  [name && `name=~/${name.source}/`, email && `email=~/${email.source}/`]
    .filter(Boolean)
    .join(" 且 ");

// 规则匹配：提供的正则必须全部命中（字段缺失视为不匹配）
const matches = (rule, name, email) => {
  if (rule.name && (name == null || !rule.name.test(name))) return false;
  if (rule.email && (email == null || !rule.email.test(email))) return false;
  return true;
};

let violations = 0;

// 1. git 提交的作者与邮箱
if (baseRev !== "-") {
  const log = execFileSync(
    "git",
    ["log", "--format=%an%x09%ae", `${baseRev}..${headRev}`],
    { encoding: "utf8" }
  );
  for (const line of log.split("\n").filter(Boolean)) {
    const [name, email] = line.split("\t");
    for (const rule of rules) {
      if (matches(rule, name, email)) {
        console.error(`::error::git 提交作者命中黑名单: ${name} <${email}>（规则: ${describe(rule)}）`);
        violations++;
        break;
      }
    }
  }
}

// 2. 索引条目的作者与邮箱
const archiveDir = join(root, "index", "archive");
if (existsSync(archiveDir)) {
  for (const f of readdirSync(archiveDir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f))) {
    const { submissions } = JSON.parse(readFileSync(join(archiveDir, f), "utf8"));
    for (const s of submissions) {
      for (const rule of rules) {
        if (matches(rule, s.author, s.email)) {
          console.error(
            `::error::索引稿件命中黑名单: ${s.platform}/${s.owner}/${s.repo}/${s.slug} ` +
              `author=${s.author ?? "无"} email=${s.email ?? "无"}（规则: ${describe(rule)}）`
          );
          violations++;
          break;
        }
      }
    }
  }
}

if (violations) process.exit(1);
console.log(`ok: 0 hits against ${rules.length} blacklist rules`);
