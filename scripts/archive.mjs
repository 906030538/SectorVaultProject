// 定时任务：归档溢出的索引条目，并清理已不存在的用户仓库记录。
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

// 2. 未归档索引超过 1024 条时，按月份归档溢出部分
if (index.submissions.length > MAX_CURRENT) {
  const overflow = index.submissions.length - MAX_CURRENT;
  const archived = index.submissions.slice(0, overflow);
  index.submissions = index.submissions.slice(overflow);

  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const archivePath = join(archiveDir, `${monthKey}.json`);
  const prev = existsSync(archivePath)
    ? JSON.parse(readFileSync(archivePath, "utf8"))
    : { submissions: [], users: [] };
  prev.submissions.push(...archived);
  // 归档时同步冻结归档月份涉及的用户记录
  prev.users = users;
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(archivePath, JSON.stringify(prev, null, 2) + "\n");
}

index.users = users;
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
console.log(`done: ${index.submissions.length} submissions in current index`);
