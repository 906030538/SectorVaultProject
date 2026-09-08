// 镜像同步：将本次推送改动的归档文件通过 GitHub API 提交 PR 到主索引仓。
// 在镜像仓（Gitee/Atomgit）的门禁流水线中、校验全部通过后调用。
// 环境变量：
//   GITHUB_TOKEN    必填，具有主索引仓 contents:write / pulls:write 权限的 token
//   GITHUB_REPO     默认 906030538/SectorVaultProject
//   GITHUB_BASE     目标分支，默认 index
//   MIRROR_PLATFORM gitee | atomgit，用于同步分支命名
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("missing GITHUB_TOKEN");
  process.exit(1);
}
const repo = process.env.GITHUB_REPO ?? "906030538/SectorVaultProject";
const base = process.env.GITHUB_BASE ?? "index";
const platform = process.env.MIRROR_PLATFORM ?? "mirror";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const short = sha.slice(0, 7);
const prev = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "-q", "HEAD~1"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
})();

const changed = execFileSync(
  "git",
  ["diff", "--name-only", ...(prev ? [prev, sha] : [])],
  { encoding: "utf8" }
)
  .split("\n")
  .filter((f) => f.startsWith("index/archive/") && f.endsWith(".json"));
if (!changed.length) {
  console.log("no archive changes in this push, nothing to sync");
  process.exit(0);
}

const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
};

// 幂等：同名 PR 已开则直接结束
const head = `mirror/${platform}/${short}`;
const openPrs = await api(
  `/repos/${repo}/pulls?head=${repo.split("/")[0]}:${head}&state=open`
);
if (openPrs.length) {
  console.log(`PR already open: ${openPrs[0].html_url}`);
  process.exit(0);
}

// 从主索引仓基准分支头创建同步分支（已存在则复用，支持中断后重跑）
const { object: { sha: baseSha } } = await api(`/repos/${repo}/git/ref/heads/${base}`);
try {
  await api(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${head}`, sha: baseSha }),
  });
} catch (e) {
  if (!/already exists|422/.test(e.message)) throw e;
}

// 逐个写入本次改动的归档文件
for (const file of changed) {
  const content = readFileSync(file, "utf8");
  let fileSha = null;
  try {
    fileSha = (await api(`/repos/${repo}/contents/${file}?ref=${encodeURIComponent(head)}`)).sha;
  } catch {
    // 同步分支上尚无该文件
  }
  await api(`/repos/${repo}/contents/${file}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `mirror(${platform}): sync ${file} @ ${short}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: head,
      ...(fileSha ? { sha: fileSha } : {}),
    }),
  });
}

const pr = await api(`/repos/${repo}/pulls`, {
  method: "POST",
  body: JSON.stringify({
    title: `mirror(${platform}): sync ${short}`,
    head,
    base,
    body: `来自 ${platform} 镜像仓库的投稿同步（commit ${short}），已通过镜像门禁校验（schema + 投稿日期不可变）。`,
  }),
});
console.log(`PR created: ${pr.html_url}`);
