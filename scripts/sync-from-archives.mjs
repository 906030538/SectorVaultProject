// 重建前置阶段：从所有已索引仓库的根目录 svp-archive.json 同步稿件。
//   - 内容仓记录有、索引缺失的稿件 → 按投稿月份补入归档；
//   - 内容仓已删除（svp-archive.json 中不存在）的稿件 → 从索引移除；
//   - 仓库/文件 404、410 → 视为已删除，移除该仓库全部条目与用户记录；
//     其他错误（网络/超时/5xx）→ 保留并警告，防止瞬时故障造成误删。
// 条目按 slug 对比；双方都有时不修改（修改走 PR 门禁流程），仅当
// submittedAt 不一致时输出警告（索引投稿日期不可变）。
// 归档为事实来源，写回 index/archive/YYYY-MM.json（按 submittedAt 排序）。
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const archiveDir = join(root, "index", "archive");

// ---- 读取现有归档 ----
const months = existsSync(archiveDir)
  ? readdirSync(archiveDir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f)).sort()
  : [];
const archives = new Map(); // month -> {submissions, users}
for (const m of months) {
  archives.set(m, JSON.parse(readFileSync(join(archiveDir, m), "utf8")));
}
const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;
const monthOf = (iso) => iso.slice(0, 7);

// ---- 收集已索引的仓库（来自用户记录）----
const repos = new Map(); // "platform/owner/repo" -> {platform, owner, repo}
for (const [, data] of archives) {
  for (const u of data.users ?? []) {
    for (const { repo } of u.repos ?? []) {
      repos.set(`${u.platform}/${u.owner}/${repo}`, { platform: u.platform, owner: u.owner, repo });
    }
  }
}

// ---- 抓取 svp-archive.json（平台 raw 地址，与 check-mirrors 相同的回退链）----
const archiveUrls = (r) => {
  const urls = [];
  if (r.platform === "github") {
    urls.push(`https://raw.githubusercontent.com/${r.owner}/${r.repo}/HEAD/svp-archive.json`);
  } else {
    for (const br of ["HEAD", "main", "master"]) {
      urls.push(`https://${r.platform === "gitee" ? "gitee.com" : "atomgit.com"}/${r.owner}/${r.repo}/raw/${br}/svp-archive.json`);
    }
  }
  return urls;
};

// 返回 {status: "ok", submissions} | {status: "gone"} | {status: "unreachable", error}
const fetchArchive = async (r) => {
  let saw404 = false;
  let lastErr;
  for (const url of archiveUrls(r)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404 || res.status === 410) {
        saw404 = true;
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      return { status: "ok", submissions: data.submissions ?? [] };
    } catch (e) {
      lastErr = e;
    }
  }
  if (saw404) return { status: "gone" };
  return { status: "unreachable", error: lastErr?.message ?? "unknown" };
};

let added = 0;
let removed = 0;
const removeRepoKeys = new Set(); // 该仓库整体移除

for (const r of repos.values()) {
  const result = await fetchArchive(r);
  if (result.status === "gone") {
    console.log(`gone: ${r.platform}/${r.owner}/${r.repo}（仓库或 svp-archive.json 已不存在），移除其全部条目`);
    removeRepoKeys.add(`${r.platform}/${r.owner}/${r.repo}`);
    continue;
  }
  if (result.status === "unreachable") {
    console.warn(`warn: ${r.platform}/${r.owner}/${r.repo} 无法访问（${result.error}），跳过并保留现有条目`);
    continue;
  }

  // 该仓库的索引条目 vs 内容仓记录
  const repoId = `${r.platform}/${r.owner}/${r.repo}`;
  const indexed = new Map(); // slug -> {month, entry}
  for (const [month, data] of archives) {
    for (const s of data.submissions) {
      if (`${s.platform}/${s.owner}/${s.repo}` === repoId) indexed.set(s.slug, { month, entry: s });
    }
  }
  const remote = new Map(result.submissions.map((s) => [s.slug, s]));

  // 补充缺失
  for (const s of result.submissions) {
    if (indexed.has(s.slug)) {
      const cur = indexed.get(s.slug).entry;
      if (cur.submittedAt !== s.submittedAt) {
        console.warn(`warn: ${entryKey(s)} 投稿时间不一致（索引 ${cur.submittedAt} / 内容仓 ${s.submittedAt}），保留索引值`);
      }
      continue;
    }
    const file = `${monthOf(s.submittedAt)}.json`;
    if (!/^\d{4}-\d{2}\.json$/.test(file)) {
      console.warn(`warn: ${entryKey(s)} 投稿时间非法（${s.submittedAt}），跳过`);
      continue;
    }
    if (!archives.has(file)) {
      archives.set(file, { submissions: [], users: [] });
      console.log(`created archive file: ${file}`);
    }
    archives.get(file).submissions.push(s);
    console.log(`add: ${entryKey(s)} -> ${file}`);
    added++;
  }

  // 移除已删除（整体移除的仓库也走这里统一清理）
  for (const [slug, { month, entry }] of indexed) {
    if (removeRepoKeys.has(repoId) || !remote.has(slug)) {
      const data = archives.get(month);
      data.submissions = data.submissions.filter((s) => s !== entry);
      console.log(`remove: ${entryKey(entry)} from ${month}`);
      removed++;
    }
  }
}

// 用户记录清理：整体移除的仓库从 users 中删除
if (removeRepoKeys.size) {
  for (const [, data] of archives) {
    for (const u of data.users ?? []) {
      u.repos = (u.repos ?? []).filter(({ repo }) => !removeRepoKeys.has(`${u.platform}/${u.owner}/${repo}`));
    }
    data.users = (data.users ?? []).filter((u) => (u.repos ?? []).length > 0);
  }
}

// ---- 写回归档（key 即文件名）----
mkdirSync(archiveDir, { recursive: true });
for (const [file, data] of [...archives.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  data.submissions.sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  writeFileSync(join(archiveDir, file), JSON.stringify(data, null, 2) + "\n");
}

console.log(`sync done: +${added} -${removed}, repos=${repos.size}`);
