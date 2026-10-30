// 敏感内容打分引擎（纯函数，无 DOM 依赖）：与索引仓门禁
// SectorVaultProject/scripts/check-sensitive.mjs 保持同一套规则——
// NFKC+lowercase 归一化（与词包白名单同口径）、拉丁词整 token 匹配、
// 子串双遍（归一化+紧凑形）防分隔符规避、URL 摘出只查 ad 类、
// 2 字词打折/正文不计、弱类拉丁正文不计、同词饱和。
// 词包为 dict-resources 的 SVPX 容器（deflate-raw + 16B XOR，混淆非加密）。
import { inflateSync } from 'fflate';

export interface ScoreResult {
  total: number;
  perCategory: Record<string, number>;
}

export interface SensitiveMatcher {
  /** weight: 1=长文本（稿件/讨论正文），2=短文本（评论，作者主动写就信号更强） */
  score(text: string, weight: 1 | 2): ScoreResult;
}

const CATEGORY_WEIGHT: Record<string, number> = { politics: 10, porn: 8, violence: 8, ad: 3, other: 3, mixed: 2 };
const WEAK_CATS = new Set(['ad', 'mixed', 'other']);
const URL_FRAGMENT_RE = /^[.:]|[.:$/]$|[:/]/;
const NOISE_TOKEN = new Set(['www', 'com', 'net', 'org', 'http', 'https', 'html', 'php', 'cn']);
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`）)\]]+/g;
const COMPACT_RE = /[\s\u200b-\u200f\u2060\ufeff\-_*·•・.。,，、!！?？:：;；~^'"`（）()[\]【】<>《》…]/g;
const LATIN_RE = /^[a-z0-9]+$/;

const norm = (s: string) => s.normalize('NFKC').toLowerCase();
const compact = (s: string) => norm(s).replace(COMPACT_RE, '');
const lenFactor = (w: string) => Math.min(Math.max(w.length, 2), 8) / 2;
/** 2 字词：短文本 ×0.25，长文本不计（子串噪声不可控：计划/夏天/毕业/支持…） */
const shortFactor = (w: string, weight: 1 | 2) => (w.length === 2 ? (weight === 1 ? 0 : 0.25) : 1);
/** 同词第 1 次全分，第 2/3 次各半分，第 4+ 次不计 */
const occFactor = (n: number) => Math.min(1 + 0.5 * (Math.min(n, 3) - 1), 2);

/** SVPX 容器解包：magic(4B) + ver(1B) + key(16B) + XOR(deflate-raw(json)) */
function unpackSvpx(buf: Uint8Array): { v: number; items: Record<string, string[]> } {
  const MAGIC = [0x53, 0x56, 0x50, 0x58]; // "SVPX"
  if (buf.length < 21 || MAGIC.some((b, i) => buf[i] !== b)) throw new Error('bad magic');
  if (buf[4] !== 1) throw new Error(`unsupported version ${buf[4]}`);
  const key = buf.subarray(5, 21);
  const data = new Uint8Array(buf.length - 21);
  for (let i = 0; i < data.length; i++) data[i] = buf[21 + i] ^ key[i % 16];
  return JSON.parse(new TextDecoder().decode(inflateSync(data))) as { v: number; items: Record<string, string[]> };
}

interface WordEntry {
  w: string;
  cats: string[];
  latin: boolean;
}

/** Aho-Corasick 自动机（children[node] = Map(codePoint → node)，BFS 建 fail 与合并输出） */
interface Automaton {
  children: Map<number, number>[];
  fail: number[];
  out: number[][];
}

function buildAutomaton(items: WordEntry[]): Automaton {
  const children: Map<number, number>[] = [new Map()];
  const fail = [0];
  const out: number[][] = [[]];
  let count = 1;
  for (let i = 0; i < items.length; i++) {
    let cur = 0;
    for (const ch of items[i].w) {
      const c = ch.codePointAt(0)!;
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

/** 词包字节 → 打分器；格式非法抛错（由调用方决定停用） */
export function buildMatcher(pack: Uint8Array): SensitiveMatcher {
  const raw = unpackSvpx(pack).items;
  const merged = new Map<string, Set<string>>();
  for (const [cat, words] of Object.entries(raw)) {
    if (!Array.isArray(words)) continue;
    for (const word of words) {
      const nw = norm(word);
      if (nw.length < 2 || URL_FRAGMENT_RE.test(nw) || NOISE_TOKEN.has(nw)) continue;
      if (!merged.has(nw)) merged.set(nw, new Set());
      merged.get(nw)!.add(cat);
    }
  }
  const items: WordEntry[] = [...merged].map(([w, cats]) => ({ w, cats: [...cats], latin: LATIN_RE.test(w) }));
  const ac = buildAutomaton(items);
  const tokenIndex = new Map<string, number[]>();
  items.forEach((it, wi) => {
    if (it.latin) tokenIndex.set(it.w, [...(tokenIndex.get(it.w) ?? []), wi]);
  });

  /** 子串通道（跳过拉丁词——拉丁词只走整 token 通道，防止 default 命中 lt 一类）；
   *  leftmost-longest 去重叠：命中「法轮功」不再重复计「法轮」「轮功」 */
  const scanAll = (text: string, result: Map<number, number>): void => {
    const positions: [number, number, number][] = [];
    let cur = 0;
    for (let i = 0; i < text.length; ) {
      const c = text.codePointAt(i)!;
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
    positions.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const counts = new Map<number, number>();
    let lastEnd = -1;
    for (const [start, len, wi] of positions) {
      if (start < lastEnd) continue;
      lastEnd = start + len;
      counts.set(wi, (counts.get(wi) ?? 0) + 1);
    }
    for (const [wi, n] of counts) result.set(wi, Math.max(n, result.get(wi) ?? 0));
  };

  const score = (text: string, weight: 1 | 2): ScoreResult => {
    const result: ScoreResult = { total: 0, perCategory: {} };
    if (!text) return result;
    const urls: string[] = [];
    const stripped = norm(text).replace(URL_RE, (m) => { urls.push(m); return ' '; });

    // 计词：normal = 全类别；adOnly = URL 内命中（打分端只取 ad 类——垃圾站点检测）
    const normal = new Map<number, number>();
    const adOnly = new Map<number, number>();
    const tokenCount = new Map<string, number>();
    for (const t of stripped.match(/[a-z0-9]+/g) ?? []) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
    for (const [t, n] of tokenCount) {
      const wis = tokenIndex.get(t);
      if (wis) for (const wi of wis) normal.set(wi, Math.max(n, normal.get(wi) ?? 0));
    }
    scanAll(stripped, normal);
    scanAll(compact(stripped), normal);
    if (urls.length) {
      const urlText = urls.join(' ');
      const urlTokens = new Map<string, number>();
      for (const t of urlText.match(/[a-z0-9]+/g) ?? []) urlTokens.set(t, (urlTokens.get(t) ?? 0) + 1);
      for (const [t, n] of urlTokens) {
        const wis = tokenIndex.get(t);
        if (wis) for (const wi of wis) adOnly.set(wi, Math.max(n, adOnly.get(wi) ?? 0));
      }
      scanAll(urlText, adOnly);
    }

    const add = (wi: number, count: number, cats: string[]): void => {
      const { w, latin } = items[wi];
      const allowed = weight === 1 && latin ? cats.filter((c) => !WEAK_CATS.has(c)) : cats;
      if (!allowed.length) return;
      const sf = shortFactor(w, weight);
      if (sf === 0) return;
      for (const c of allowed) {
        const s = (CATEGORY_WEIGHT[c] ?? 2) * lenFactor(w) * sf * weight * occFactor(count);
        result.perCategory[c] = (result.perCategory[c] ?? 0) + s;
        result.total += s;
      }
    };
    for (const [wi, n] of normal) add(wi, n, items[wi].cats);
    for (const [wi, n] of adOnly) add(wi, n, items[wi].cats.filter((c) => c === 'ad'));
    return result;
  };

  return { score };
}
