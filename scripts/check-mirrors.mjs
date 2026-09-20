// 镜像索引校验（index/mirrors.json）：
//   1. 与基线版本相比，单次只允许修改一个顶层 key（新增/删除/改动均计一次）；
//   2. 对每个源仓库：抓取源仓库与全部镜像仓根目录的 svp-archive.json，
//      其 mirrors 字段必须与源仓库完全一致（忽略顺序）。
// 用法：node scripts/check-mirrors.mjs <baseMirrorsJson> <headMirrorsJson>
// baseMirrorsJson 不存在时按 {} 处理；headMirrorsJson 不存在视为删除索引，报错。
import { readFileSync, existsSync } from "node:fs";

const [basePath, headPath] = process.argv.slice(2);
if (!headPath) {
  console.error("usage: check-mirrors.mjs <baseMirrorsJson> <headMirrorsJson>");
  process.exit(2);
}

const load = (p) => {
  if (!existsSync(p)) return p === basePath ? {} : null;
  return JSON.parse(readFileSync(p, "utf8"));
};
const base = load(basePath);
const head = load(headPath);
if (head === null) {
  console.error("::error::index/mirrors.json 不允许删除");
  process.exit(1);
}

let violations = 0;

// 1. 单次只允许修改一个顶层 key
const changedKeys = new Set();
for (const k of new Set([...Object.keys(base), ...Object.keys(head)])) {
  const a = JSON.stringify(base[k] ?? null);
  const b = JSON.stringify(head[k] ?? null);
  if (a !== b) changedKeys.add(k);
}
if (changedKeys.size > 1) {
  console.error(`::error::单次只允许修改一个源仓库条目，实际修改了 ${changedKeys.size} 个: ${[...changedKeys].join(", ")}`);
  process.exit(1);
}
if (changedKeys.size) console.log(`modified key: ${[...changedKeys].join(", ")}`);

// 2. 各仓库 svp-archive.json 的 mirrors 字段一致性
const archiveUrls = (addr) => {
  const u = addr.replace(/\.git$/, "").replace(/\/+$/, "");
  const m = u.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!m) throw new Error(`无法解析仓库地址: ${addr}`);
  const [, host, owner, repo] = m;
  const urls = [];
  if (host === "github.com" || host === "www.github.com") {
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/svp-archive.json`);
  } else {
    for (const br of ["HEAD", "main", "master"]) {
      urls.push(`https://${host}/${owner}/${repo}/raw/${br}/svp-archive.json`);
    }
  }
  urls.push(`${u}/svp-archive.json`); // 其他托管的兜底
  return urls;
};

const fetchJson = async (urls) => {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`无法访问 ${urls[0]}`);
};

const normalize = (mirrors) => JSON.stringify([...(mirrors ?? [])].sort());

const targets = changedKeys.size ? [...changedKeys] : [];
for (const src of targets) {
  const mirrors = head[src];
  if (!mirrors) {
    console.error(`::error::源仓库 ${src} 的镜像列表被清空，不允许`);
    violations++;
    continue;
  }
  let expected;
  for (const addr of [src, ...mirrors]) {
    try {
      const { mirrors: m } = await fetchJson(archiveUrls(addr));
      if (expected === undefined) {
        expected = normalize(m);
        console.log(`${addr}: mirrors=${m?.join(", ")}`);
      } else if (normalize(m) !== expected) {
        console.error(`::error::${addr} 的 svp-archive.json mirrors 字段与源仓库不一致: ${m?.join(", ")}（期望与 ${src} 相同）`);
        violations++;
      }
    } catch (e) {
      console.error(`::error::无法获取 ${addr} 的 svp-archive.json: ${e.message}`);
      violations++;
    }
  }
}

if (violations) process.exit(1);
console.log(`ok: mirrors.json consistent (${Object.keys(head).length} source entries)`);
