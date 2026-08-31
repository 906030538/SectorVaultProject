// 定时任务：归档索引条目，并清理已不存在的用户仓库记录。
// 归档规则：
//   - 非当月数据：每次运行都写入其投稿月份对应的归档 json（current.json 中保留，允许重复）；
//   - 当月数据：仅当 current.json 超过 1024 条时，将最早的溢出条目归档并从 current.json 移除。
// 需要环境变量 GITHUB_TOKEN（用于检查 GitHub 仓库是否存在）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "index", "current.json");
const archiveDir = join(root, "index", "archive");
const MAX_CURRENT = 1024;

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const now = new Date();
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const currentMonth = monthKey(now);
const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;

async function repoExists(platform, owner, repo) {
  const api = {
    github: `https://api.github.com/repos/${owner}/${repo}`,
    gitee: `https://gitee.com/api/v5/repos/${owner}/${repo}`,
    atomgit: `https://api.atomgit.com/repos/${owner}/${repo}`,
  }[platform];
  if (!api) return true;
  const headers = { Accept: "application/vnd.github+json" };
  if (platform === "github") headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(api, { headers });
  return res.ok;
}

// 1. 校验用户索引中的仓库是否存在，不存在则删除记录
const users = [];
for (const user of index.users) {
  const repos = [];
  for (const { repo } of user.repos) {
    if (await repoExists(user.platform, user.owner, repo)) repos.push({ repo });
    else console.log(`prune missing repo: ${user.platform}/${user.owner}/${repo}`);
  }
  if (repos.length) users.push({ ...user, repos });
}

// 2. 确定需要归档的条目：非当月全部；当月数据仅在被裁剪时归档
const toArchive = new Map(); // monthKey -> entries
const currentMonthEntries = [];
for (const s of index.submissions) {
  const month = monthKey(new Date(s.submittedAt));
  if (month !== currentMonth) {
    if (!toArchive.has(month)) toArchive.set(month, []);
    toArchive.get(month).push(s);
  } else {
    currentMonthEntries.push(s);
  }
}
// 超过阈值时只裁剪最早的当月条目（非当月数据保留在 current.json，与归档重复）
if (index.submissions.length > MAX_CURRENT) {
  const overflow = index.submissions.length - MAX_CURRENT;
  const removed = new Set();
  for (const s of currentMonthEntries.slice(0, overflow)) removed.add(entryKey(s));
  if (!toArchive.has(currentMonth)) toArchive.set(currentMonth, []);
  toArchive.get(currentMonth).push(...currentMonthEntries.filter((s) => removed.has(entryKey(s))));
  index.submissions = index.submissions.filter((s) => !removed.has(entryKey(s)));
}

// 3. 写入各月归档 json 并更新归档元数据
const countByType = (subs) => ({
  project: subs.filter((s) => s.type === "project").length,
  article: subs.filter((s) => s.type === "article").length,
});

const archives = [];
mkdirSync(archiveDir, { recursive: true });
const months = [...toArchive.keys()].sort();
for (const month of months) {
  const fileName = `${month}.json`;
  const archivePath = join(archiveDir, fileName);
  const prev = existsSync(archivePath)
    ? JSON.parse(readFileSync(archivePath, "utf8"))
    : { submissions: [], users: [] };
  // 按唯一键去重合并（current.json 与归档允许重复，但归档文件自身不重复）
  const seen = new Set(prev.submissions.map(entryKey));
  for (const s of toArchive.get(month)) if (!seen.has(entryKey(s))) prev.submissions.push(s);
  prev.submissions.sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  prev.users = users;
  writeFileSync(archivePath, JSON.stringify(prev, null, 2) + "\n");
  archives.push({
    file: fileName,
    submissions: prev.submissions.length,
    byType: countByType(prev.submissions),
  });
}
// 未发生写入的月份保留原有元数据条目
for (const old of index.archives ?? []) {
  if (!months.some((m) => `${m}.json` === old.file)) archives.push(old);
}
archives.sort((a, b) => (a.file < b.file ? -1 : 1));
index.archives = archives;

index.users = users;
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
console.log(`done: ${index.submissions.length} submissions in current index`);
