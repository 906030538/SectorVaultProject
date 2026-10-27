// 敏感内容扫描门禁：对 PR 中新增/修改的稿件条目打分，超过阈值拒绝合入。
// 打分规则设计见 docs/sensitive-scan.md。
//
// 用法: node scripts/check-sensitive.mjs <baseArchiveDir> <headArchiveDir> [--pack <path>] [--no-body]
//   baseArchiveDir/headArchiveDir  基线与 PR 的 index/archive 目录
//   --pack    SVPX 词包路径（缺失时输出 scan=skipped 并放行——可用性优先，fail-open）
//   --no-body 跳过内容仓正文拉取（本地校准/测试用）
// 输出（写入 GITHUB_OUTPUT，同时打印）:
//   scan=pass|blocked|skipped  score=<总分>  threshold=<阈值>  detail=<分类得分汇总>
//
// 纪律：命中词与原文片段绝不输出——PR 评论与 Actions 日志对投稿者公开，
// 输出命中词等于泄露词典内容并提供试探通道。只输出分类得分与命中计数。
import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const argOpt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : undefined;
};
const baseDir = argv[0];
const headDir = argv[1];
const packPath = argOpt("--pack");
const noBody = argv.includes("--no-body");
if (!baseDir || !headDir) {
  console.error("usage: check-sensitive.mjs <baseArchiveDir> <headArchiveDir> [--pack <path>] [--no-body]");
  process.exit(2);
}

const emit = (kv) => {
  for (const [k, v] of Object.entries(kv)) {
    console.log(`${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
};
const finish = (kv) => { emit(kv); process.exit(0); };

// ---------- 配置 ----------
const readConfig = () => {
  for (const p of [
    resolve(headDir, "../../config.json"),
    join(SCRIPT_ROOT, "config.json"),
  ]) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* 坏配置走默认 */ }
    }
  }
  return {};
};
const scanCfg = readConfig().sensitiveScan ?? {};

// ---------- SVPX 解包（与 dict-resources scripts/pack.mjs 布局一致） ----------
function unpackSvpx(buf) {
  const MAGIC = Buffer.from("SVPX");
  if (buf.length < 21 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error("bad magic");
  if (buf[4] !== 1) throw new Error(`unsupported version ${buf[4]}`);
  const key = buf.subarray(5, 21);
  const data = Buffer.from(buf.subarray(21));
  for (let i = 0; i < data.length; i++) data[i] ^= key[i % 16];
  return JSON.parse(inflateRawSync(data).toString("utf8"));
}

// ---------- 归一化（与词包白名单同口径：NFKC + lowercase） ----------
const norm = (s) => s.normalize("NFKC").toLowerCase();
// 紧凑形：再去掉空白/零宽/常见分隔符，防「字间加符号」规避（法*轮*功）
const COMPACT_RE = /[\s\u200b-\u200f\u2060\ufeff\-_*·•・.。,，、!！?？:：;；~^'"`（）()[\]【】<>《》…]/g;
const compact = (s) => norm(s).replace(COMPACT_RE, "");
// URL 碎片段（"www."、".com"、"http:/" 一类）：任何带链接的正文必中，纯噪声，加载即丢弃。
// 完整域名（如 "000.bbexe.cn"）不含首尾点，不受影响，照常子串匹配。
const URL_FRAGMENT_RE = /^[.:]|[.:$/]$|[:/]/;
// 基础设施 token（裸 "www"/"com"/"http" 等）：与 "www." 同性质的噪声，无内容信号
const NOISE_TOKEN = new Set(["www", "com", "net", "org", "http", "https", "html", "php", "cn"]);
// URL 整体摘出：链接只参与 ad 类（垃圾站点）检测——youtube/bilibili 等平台名在
// politics（GFW 名单）里，视频链接 credit 是站点核心功能，不构成内容信号；
// 正文散文中裸写平台名不受影响（token 通道照常命中）。
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`）)\]]+/g;

// ---------- Aho-Corasick 自动机 ----------
function buildAutomaton(items) {
  const children = [new Map()]; // node -> Map(codePoint -> node)
  const fail = [0];
  const out = [[]];             // node -> word 下标数组（BFS 时并入 fail 链输出）
  let count = 1;
  for (let i = 0; i < items.length; i++) {
    let cur = 0;
    for (const ch of items[i].w) {
      const c = ch.codePointAt(0);
      let nxt = children[cur].get(c);
      if (nxt === undefined) {
        nxt = count++;
        children[cur].set(c, nxt);
        children.push(new Map());
        fail.push(0);
        out.push([]);
      }
      cur = nxt;
    }
    out[cur].push(i);
  }
  const queue = [...children[0].values()];
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    for (const [c, v] of children[u]) {
      let f = fail[u];
      for (;;) {
        const t = children[f].get(c);
        if (t !== undefined && t !== v) { fail[v] = t; break; }
        if (f === 0) { fail[v] = 0; break; }
        f = fail[f];
      }
      out[v] = out[v].length ? out[v].concat(out[fail[v]]) : out[fail[v]];
      queue.push(v);
    }
  }
  return { children, fail, out };
}

// ---------- 打分 ----------
const CATEGORY_WEIGHT = { politics: 10, porn: 8, violence: 8, ad: 3, other: 3, mixed: 2 };
// 弱类（未分类噪声大户）：其拉丁 token 只在条目字段计分——英文歌词/长文正文
// 必撞词包里的通用英文词（party/dance 一类），子串渠道的域名（带点）不受影响
const WEAK_CATS = new Set(["ad", "mixed", "other"]);
const FIELD_WEIGHT = 2;    // 索引条目文本字段：作者主动写就，信号更强
const BODY_WEIGHT = 1;     // 内容仓正文
// 2 字词：子串命中在正常文本里噪声极高（计划/夏天/毕业/av/lt…）。
// 条目字段（短文本、作者主动写就）打 2.5 折计分；正文不计分（歌词/长文必然撞常用词，噪声不可控）。
// 单个 2 字词不构成证据，证据靠 3+ 字词与多词累积。
const shortFactor = (w, weight) =>
  w.length === 2 ? (weight === BODY_WEIGHT ? 0 : 0.25) : 1;
const LATIN_RE = /^[a-z0-9]+$/;
const MAX_BODY_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SCAN_ENTRIES = 20;
// 单词饱和：第 1 次全分，第 2/3 次各半分，第 4+ 次不计（防重复刷屏放大）
const occFactor = (count) => Math.min(1 + 0.5 * (Math.min(count, 3) - 1), 2);
const lenFactor = (w) => Math.min(Math.max(w.length, 2), 8) / 2;

// ---------- 变更条目提取（与 check-pr-scope 同键同口径） ----------
const entryKey = (s) => `${s.platform}/${s.owner}/${s.repo}/${s.slug}`;
function loadArchives(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((f) => /^[0-9]{4}-[0-9]{2}\.json$/.test(f))) {
    const { submissions } = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const s of submissions) map.set(entryKey(s), s);
  }
  return map;
}

// ---------- 正文拉取（best-effort：失败只跳过正文扫描，条目字段照扫） ----------
async function fetchReadme(entry) {
  const path = `posts/${encodeURIComponent(entry.slug)}/README.md`;
  const { platform, owner, repo } = entry;
  const o = encodeURIComponent(owner), r = encodeURIComponent(repo);
  const rawHead = {
    github: `https://raw.githubusercontent.com/${o}/${r}/HEAD/${path}`,
    gitee: `https://gitee.com/${o}/${r}/raw/HEAD/${path}`,
    atomgit: `https://atomgit.com/${o}/${r}/raw/HEAD/${path}`,
  }[platform];
  const apiRepo = {
    github: `https://api.github.com/repos/${o}/${r}`,
    gitee: `https://gitee.com/api/v5/repos/${o}/${r}`,
    atomgit: `https://api.atomgit.com/repos/${o}/${r}`,
  }[platform];
  const rawBranch = (b) => ({
    github: `https://raw.githubusercontent.com/${o}/${r}/${b}/${path}`,
    gitee: `https://gitee.com/${o}/${r}/raw/${b}/${path}`,
    atomgit: `https://atomgit.com/${o}/${r}/raw/${b}/${path}`,
  })[platform];
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.text()).slice(0, MAX_BODY_BYTES);
  };
  try {
    // raw 端点的 HEAD 引用可解析默认分支；不支持时回退仓库 API 查 default_branch
    const direct = await get(rawHead);
    if (direct !== null) return direct;
    const info = await fetch(apiRepo, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!info.ok) return null;
    const branch = (await info.json()).default_branch;
    return branch ? await get(rawBranch(branch)) : null;
  } catch {
    return null;
  }
}

// ---------- 主流程 ----------
const main = async () => {
  const threshold = Number.isFinite(scanCfg.threshold) ? scanCfg.threshold : 30;
  const perCategoryLimit = Number.isFinite(scanCfg.perCategory) ? scanCfg.perCategory : 25;
  const thresholds = `${threshold}/${perCategoryLimit}`;
  if (scanCfg.enabled === false) {
    console.log("sensitiveScan.enabled=false，扫描停用");
    return finish({ scan: "skipped", score: 0, threshold: thresholds, detail: "disabled" });
  }
  if (!packPath || !existsSync(packPath)) {
    console.log("::warning::词包缺失（dict-resources 拉取失败或未配置），敏感扫描跳过（fail-open）");
    return finish({ scan: "skipped", score: 0, threshold: thresholds, detail: "no-pack" });
  }

  // 1. 解包 + 归一化合并（同形异码词合并类别）
  let items; // { word, cats[] }[]
  try {
    const t0 = Date.now();
    const { items: rawItems } = unpackSvpx(readFileSync(packPath));
    const merged = new Map(); // normWord -> Set(category)
    let wordCount = 0;
    for (const [cat, words] of Object.entries(rawItems)) {
      if (!Array.isArray(words)) continue;
      wordCount += words.length;
      for (const w of words) {
        const nw = norm(w);
        if (nw.length < 2 || URL_FRAGMENT_RE.test(nw) || NOISE_TOKEN.has(nw)) continue;
        if (!merged.has(nw)) merged.set(nw, new Set());
        merged.get(nw).add(cat);
      }
    }
    items = [...merged].map(([w, cats]) => ({ w, cats: [...cats], latin: LATIN_RE.test(w) }));
    console.log(`pack: ${wordCount} words -> ${items.length} normalized entries (${Date.now() - t0}ms)`);
  } catch (e) {
    console.log(`::warning::词包解析失败（${e.message}），敏感扫描跳过（fail-open）`);
    return finish({ scan: "skipped", score: 0, threshold: thresholds, detail: "bad-pack" });
  }

  // 2. 建自动机 + 拉丁 token 索引
  const t1 = Date.now();
  const ac = buildAutomaton(items);
  const tokenIndex = new Map(); // 拉丁词原文 -> [wordIdx]（整 token 匹配用）
  items.forEach((it, wi) => {
    if (it.latin) tokenIndex.set(it.w, [...(tokenIndex.get(it.w) ?? []), wi]);
  });
  console.log(`automaton built (${Date.now() - t1}ms)`);

  // 3. 变更条目
  const base = loadArchives(baseDir);
  const head = loadArchives(headDir);
  const changed = [];
  for (const [k, s] of head) {
    const b = base.get(k);
    if (!b || JSON.stringify(b) !== JSON.stringify(s)) changed.push(s);
  }
  if (!changed.length) {
    console.log("no changed submissions, nothing to scan");
    return finish({ scan: "pass", score: 0, threshold: thresholds, detail: "{}" });
  }
  if (changed.length > MAX_SCAN_ENTRIES) changed.length = MAX_SCAN_ENTRIES;

  /** 单文本计词 → { normal: Map(wi→max次数), adOnly: Map(wi→max次数) }
   *  拉丁词（^[a-z0-9]+$）：只整 token 精确匹配（av 不得命中 maihime/default 内部）
   *  其余词：归一化 + 紧凑形两遍子串扫描取 max（紧凑形防「字间加符号」规避）
   *  URL（scheme/www 开头）：整体摘出，只按 ad 类检测（垃圾域名）；其余类别不扫链接 */
  const countWords = (text) => {
    const result = { normal: new Map(), adOnly: new Map() };
    if (!text) return result;
    const urls = [];
    const stripped = norm(text).replace(URL_RE, (m) => { urls.push(m); return " "; });
    const bump = (m, wi, n) => m.set(wi, Math.max(n, m.get(wi) ?? 0));
    // A) 拉丁整 token（非链接文本）
    const tokenCount = new Map();
    for (const t of stripped.match(/[a-z0-9]+/g) ?? []) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
    for (const [t, n] of tokenCount) {
      const wis = tokenIndex.get(t);
      if (wis) for (const wi of wis) bump(result.normal, wi, n);
    }
    // B) 子串（跳过拉丁词——它们只走 A 通道，防止 default 命中 lt 一类）
    for (const m of [scanAll(stripped), scanAll(compact(stripped))])
      for (const [wi, n] of m) bump(result.normal, wi, n);
    // C) URL：token + 子串，仅 ad 类词参与（adOnly 由打分端过滤类别）
    if (urls.length) {
      const urlText = urls.join(" ");
      const urlTokens = new Map();
      for (const t of urlText.match(/[a-z0-9]+/g) ?? []) urlTokens.set(t, (urlTokens.get(t) ?? 0) + 1);
      for (const [t, n] of urlTokens) {
        const wis = tokenIndex.get(t);
        if (wis) for (const wi of wis) bump(result.adOnly, wi, n);
      }
      for (const [wi, n] of scanAll(urlText)) bump(result.adOnly, wi, n);
    }
    return result;
  };
  function scanAll(text) {
    const positions = [];
    let cur = 0;
    for (let i = 0; i < text.length; ) {
      const c = text.codePointAt(i);
      const size = c > 0xffff ? 2 : 1;
      for (;;) {
        const nxt = ac.children[cur].get(c);
        if (nxt !== undefined) { cur = nxt; break; }
        if (cur === 0) break;
        cur = ac.fail[cur];
      }
      const o = ac.out[cur];
      for (let j = 0; j < o.length; j++)
        if (!items[o[j]].latin) positions.push([i, items[o[j]].w.length, o[j]]);
      i += size;
    }
    // leftmost-longest：同起点取长词，重叠短词丢弃（法轮功 不再重复计 法轮/轮功）
    positions.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const counts = new Map();
    let lastEnd = -1;
    for (const [start, len, wi] of positions) {
      if (start < lastEnd) continue;
      lastEnd = start + len;
      counts.set(wi, (counts.get(wi) ?? 0) + 1);
    }
    return counts;
  }

  // 4. 打分（逐条目判定：单条稿件自身的命中累积，不跨条目摊薄/放大）
  let worst = { score: 0, perCategory: {} };
  let hitWords = 0, scanned = 0, bodyFetched = 0, bodyFailed = 0;
  for (const entry of changed) {
    scanned++;
    const sources = [
      { text: entry.title, weight: FIELD_WEIGHT },
      { text: entry.author, weight: FIELD_WEIGHT },
      ...["tags", "songs", "engines", "voicebanks", "languages"]
        .map((f) => (Array.isArray(entry[f]) ? entry[f].join(" ") : ""))
        .map((text) => ({ text, weight: FIELD_WEIGHT })),
    ];
    if (!noBody) {
      const body = await fetchReadme(entry);
      if (body !== null) { bodyFetched++; sources.push({ text: body, weight: BODY_WEIGHT }); }
      else bodyFailed++;
    }
    let entryScore = 0;
    const entryCats = {};
    for (const { text, weight } of sources) {
      const { normal, adOnly } = countWords(text);
      const scoreHit = (wi, count, cats) => {
        const { w, latin } = items[wi];
        const allowed = weight === BODY_WEIGHT && latin
          ? cats.filter((c) => !WEAK_CATS.has(c))
          : cats;
        if (!allowed.length) return;
        hitWords++;
        for (const c of allowed) {
          const cw = CATEGORY_WEIGHT[c] ?? 2;
          const s = cw * lenFactor(w) * shortFactor(w, weight) * weight * occFactor(count);
          entryCats[c] = (entryCats[c] ?? 0) + s;
          entryScore += s;
        }
      };
      for (const [wi, count] of normal) scoreHit(wi, count, items[wi].cats);
      for (const [wi, count] of adOnly) scoreHit(wi, count, items[wi].cats.filter((c) => c === "ad"));
    }
    if (entryScore > 0) console.log(`entry ${entryKey(entry)}: score ${entryScore.toFixed(1)}（仅分值，不输出命中内容）`);
    if (entryScore > worst.score) worst = { score: entryScore, perCategory: entryCats };
  }

  const total = Math.round(worst.score * 10) / 10;
  const catMax = Math.max(0, ...Object.values(worst.perCategory));
  const blocked = total >= threshold || catMax >= perCategoryLimit;
  const detail = JSON.stringify(Object.fromEntries(
    Object.entries(worst.perCategory).map(([c, s]) => [c, Math.round(s * 10) / 10])
  ));
  console.log(`scanned ${scanned} entries (body: ${bodyFetched} ok, ${bodyFailed} unreachable), ` +
    `hitWords=${hitWords}, score=${total}, perCategoryMax=${Math.round(catMax * 10) / 10}`);
  return finish({
    scan: blocked ? "blocked" : "pass",
    score: total,
    threshold: thresholds,
    detail,
  });
};

main().catch((e) => {
  // 脚本自身崩溃不阻塞投稿（可用性优先）；崩溃详情进日志供管理员排查
  console.log(`::warning::敏感扫描脚本异常（${e.message}），跳过（fail-open）`);
  emit({ scan: "skipped", score: 0, threshold: "-", detail: "error" });
  process.exit(0);
});
