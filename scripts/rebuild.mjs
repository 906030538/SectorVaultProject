// 从归档索引重建 current.json（归档是事实来源，current 是派生数据）。
//   1. 合并 index/archive/*.json 的全部稿件，按唯一键去重、按投稿时间倒序；
//   2. 截取最近 currentLimit 条（config.json，可用环境变量 CURRENT_LIMIT 覆盖）；
//   3. 合并用户记录，检查仓库是否存在，不存在则删除记录；
//   4. 重算 archives 元数据（每个归档文件的投稿数与分类统计）。
// 需要环境变量 GITHUB_TOKEN（用于检查 GitHub 仓库是否存在）。
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const archiveDir = join(root, "index", "archive");
const envLimit = Number(process.env.CURRENT_LIMIT);
const currentLimit = Number.isFinite(envLimit) && envLimit > 0
  ? envLimit
  : JSON.parse(readFileSync(join(root, "config.json"), "utf8")).currentLimit;

const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;
const countByType = (subs) => ({
  project: subs.filter((s) => s.type === "project").length,
  article: subs.filter((s) => s.type === "article").length,
});

async function repoExists(platform, owner, repo) {
  const api = {
    github: `https://api.github.com/repos/${owner}/${repo}`,
    gitee: `https://gitee.com/api/v5/repos/${owner}/${repo}`,
    atomgit: `https://api.atomgit.com/repos/${owner}/${repo}`,
  }[platform];
  if (!api) return true;
  const headers = { Accept: "application/vnd.github+json" };
  if (platform === "github" && process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(api, { headers });
  return res.ok;
}

// 1. 读取归档文件（按月份文件名排序）
const files = existsSync(archiveDir)
  ? readdirSync(archiveDir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f)).sort()
  : [];

const archives = [];
const allSubmissions = new Map(); // entryKey -> submission（去重，后写覆盖同键旧值）
const userMap = new Map(); // platform/owner -> user（repos 合并去重）
for (const file of files) {
  const { submissions, users } = JSON.parse(readFileSync(join(archiveDir, file), "utf8"));
  for (const s of submissions) allSubmissions.set(entryKey(s), s);
  for (const u of users) {
    const key = `${u.platform}/${u.owner}`;
    const merged = userMap.get(key) ?? { ...u, repos: [] };
    const repos = new Set(merged.repos.map((r) => r.repo));
    for (const { repo } of u.repos) repos.add(repo);
    merged.repos = [...repos].map((repo) => ({ repo }));
    userMap.set(key, merged);
  }
  archives.push({ file, submissions: submissions.length, byType: countByType(submissions) });
}

// 2. 用户索引中的仓库存活检查，不存在则删除记录
const users = [];
for (const user of userMap.values()) {
  const repos = [];
  for (const { repo } of user.repos) {
    if (await repoExists(user.platform, user.owner, repo)) repos.push({ repo });
    else console.log(`prune missing repo: ${user.platform}/${user.owner}/${repo}`);
  }
  if (repos.length) users.push({ ...user, repos });
}

// 3. 生成 current.json：最近 currentLimit 条
const submissions = [...allSubmissions.values()]
  .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
  .slice(0, currentLimit);

writeFileSync(
  join(root, "index", "current.json"),
  JSON.stringify({ submissions, users, archives }, null, 2) + "\n"
);
console.log(`rebuilt: ${submissions.length}/${allSubmissions.size} submissions from ${files.length} archives (limit ${currentLimit})`);
