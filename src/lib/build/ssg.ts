import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  DEFAULT_INDEX_SOURCES,
  INDEX_PATHS,
  POSTS_DIR,
  SENSITIVE_SCAN,
  type IndexSource,
} from '@/config';
import { mergeIndexFiles } from '@/lib/index/merge';
import { buildCardLabels } from '@/lib/labels';
import { parseReadme, type ParsedReadme } from '@/lib/content';
import { renderCard } from '@/lib/ui';
import { buildMatcher, type SensitiveMatcher } from '@/lib/sensitive/scorer';
import { DEFAULT_LOCALE } from '@/i18n';
import type { IndexFile, Platform, SubmissionEntry } from '@/types';

/**
 * 构建期 SSG 数据与渲染（仅 static 构建的 frontmatter 使用，运行期零依赖）：
 *
 * - 数据拉取绕过浏览器适配器层，直接 raw URL fetch（无 API 配额）：
 *   current + archives 合并索引、投稿 README、（可选）敏感词包；
 * - 渲染复用客户端组件（renderCard 等 DOM API），经 happy-dom 提供全局 document；
 * - 一切失败降级：正文拉不到渲染占位与外链，词包缺失过滤停用（fail-open），
 *   构建永不因单个源/稿件失败而中断。
 */

// ---- happy-dom 全局环境：服务端复用客户端 DOM 渲染 ----

let purify: ReturnType<typeof createDOMPurify> | null = null;

function ensureDom(): void {
  if (purify) return;
  const win = new Window();
  const g = globalThis as Record<string, unknown>;
  g.document ??= win.document;
  g.window ??= win;
  g.CustomEvent ??= win.CustomEvent;
  g.localStorage ??= win.localStorage;
  // happy-dom Window 与 dompurify 的 WindowLike 类型声明不一致，运行时兼容
  purify = createDOMPurify(win as unknown as Parameters<typeof createDOMPurify>[0]);
}

// ---- raw URL 规则（与各 adapter.rawUrl 一致，独立实现避免拉入 SDK）----

const RAW_URL: Record<Platform, (user: string, repo: string, path: string) => string> = {
  github: (u, r, p) => `https://raw.githubusercontent.com/${u}/${r}/HEAD/${p}`,
  gitee: (u, r, p) => `https://gitee.com/${u}/${r}/raw/HEAD/${p}`,
  atomgit: (u, r, p) => `https://atomgit.com/${u}/${r}/raw/HEAD/${p}`,
};

async function fetchText(url: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'User-Agent': 'SectorVault-SSG-Build' };
    if (process.env.SSG_TOKEN) headers.Authorization = `Bearer ${process.env.SSG_TOKEN}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const raw = await fetchText(url);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---- 索引源与合并索引（构建期一次，模块级缓存）----

const PLATFORMS = new Set(['github', 'gitee', 'atomgit']);

function ssgSources(): IndexSource[] {
  // deployment.json 与运行期同源（public/ 静态文件），构建端直接 fs 读；
  // SSG_DEPLOYMENT 可指向本地副本覆盖
  const candidates = [
    process.env.SSG_DEPLOYMENT,
    fileURLToPath(new URL('../../public/deployment.json', import.meta.url)),
  ].filter((p): p is string => !!p);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const config = JSON.parse(readFileSync(file, 'utf8')) as { indexes?: unknown };
      const list = (Array.isArray(config.indexes) ? config.indexes : [])
        .filter((s): s is IndexSource => {
          if (typeof s !== 'object' || s === null) return false;
          const it = s as Record<string, unknown>;
          return (
            typeof it.platform === 'string' &&
            PLATFORMS.has(it.platform) &&
            typeof it.owner === 'string' &&
            typeof it.repo === 'string'
          );
        })
        .map((s) => ({ ...s, branch: s.branch || 'index' }));
      if (list.length > 0) return list;
    } catch {
      /* 配置损坏时回退默认源 */
    }
  }
  return DEFAULT_INDEX_SOURCES;
}

let indexPromise: Promise<IndexFile> | undefined;

/** 构建期全量索引：各源 current.json + 清单归档合并（跨源去重） */
export function ssgIndex(): Promise<IndexFile> {
  indexPromise ??= (async () => {
    const parts: IndexFile[] = [];
    for (const source of ssgSources()) {
      const raw = (url: string) => RAW_URL[source.platform](source.owner, source.repo, url);
      const current = await fetchJson<IndexFile>(raw(INDEX_PATHS.current));
      if (!current) {
        console.warn(`[ssg] 索引源不可用，跳过 ${source.platform}:${source.owner}/${source.repo}`);
        continue;
      }
      parts.push(current);
      for (const archive of current.archives ?? []) {
        if (!archive.file.endsWith('.json')) continue;
        const part = await fetchJson<IndexFile>(raw(`${INDEX_PATHS.archiveDir}/${archive.file}`));
        if (part) parts.push(part);
      }
    }
    return mergeIndexFiles(parts);
  })();
  return indexPromise;
}

// ---- 投稿正文（README raw 拉取 + 共享解析）----

/** 投稿正文：README 拉取失败返回 null（页面降级为占位 + 外链） */
export async function ssgContent(entry: SubmissionEntry): Promise<ParsedReadme | null> {
  const base = `${POSTS_DIR}/${entry.slug}`;
  const raw = await fetchText(RAW_URL[entry.platform](entry.owner, entry.repo, `${base}/README.md`));
  if (raw === null) return null;
  try {
    return parseReadme(raw);
  } catch {
    return null;
  }
}

// ---- 敏感词门禁（词包 fs 读取，缺包 fail-open，与运行期 gate 同阈值）----

let matcher: SensitiveMatcher | null | undefined;

function ssgMatcher(): SensitiveMatcher | null {
  if (matcher !== undefined) return matcher;
  const candidates = [
    process.env.DICT_PACK_FILE,
    fileURLToPath(new URL('../../public/dict-pack.bin', import.meta.url)),
  ].filter((p): p is string => !!p);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      matcher = buildMatcher(new Uint8Array(readFileSync(file)));
      return matcher;
    } catch (e) {
      console.warn('[ssg] 词包解析失败，内容过滤停用（fail-open）:', e);
    }
  }
  matcher = null;
  console.warn('[ssg] 词包不可用，内容过滤停用（fail-open）');
  return null;
}

/** 正文是否应被屏蔽（与 gate.screenContent 的 body 判定一致） */
export function ssgScreenBlocked(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  const m = ssgMatcher();
  if (!m) return false;
  const { total, perCategory } = m.score(body, 1);
  const catMax = Math.max(0, ...Object.values(perCategory));
  return total >= SENSITIVE_SCAN.threshold || catMax >= SENSITIVE_SCAN.perCategory;
}

// ---- 渲染（happy-dom 下复用客户端组件）----

/** markdown 正文 → 净化 HTML（与详情页 DOMPurify.sanitize 同防线） */
export async function ssgMarkdownHtml(body: string): Promise<string> {
  ensureDom();
  const html = await marked.parse(body);
  return (purify!.sanitize(html) as unknown as string) ?? '';
}

/** 封面地址预解析（完整 URL 原样；内容仓相对路径拼 raw 地址） */
function coverUrl(entry: SubmissionEntry): string | null {
  if (!entry.cover) return null;
  if (entry.cover.startsWith('http')) return entry.cover;
  return RAW_URL[entry.platform](
    entry.owner,
    entry.repo,
    `${POSTS_DIR}/${entry.slug}/${entry.cover}`,
  );
}

/** 稿件卡片 HTML（构建期同步渲染，封面预解析直出） */
export function ssgCards(entries: SubmissionEntry[], opts?: { compact?: boolean }): string {
  ensureDom();
  const labels = buildCardLabels(DEFAULT_LOCALE);
  return entries
    .map((entry) => {
      const card = renderCard(entry, DEFAULT_LOCALE, labels, {
        compact: opts?.compact,
        coverUrl: coverUrl(entry),
      });
      return card.outerHTML;
    })
    .join('\n');
}

/** 工程文件 raw 下载地址 */
export function ssgRawUrl(platform: Platform, user: string, repo: string, path: string): string {
  return RAW_URL[platform](user, repo, path);
}

/** 内容仓 web 地址（「在平台查看」外链） */
export function ssgRepoUrl(platform: Platform, user: string, repo: string): string {
  const base: Record<Platform, string> = {
    github: 'https://github.com',
    gitee: 'https://gitee.com',
    atomgit: 'https://atomgit.com',
  };
  return `${base[platform]}/${user}/${repo}`;
}

/** 投稿在内容仓的目录 web 地址 */
export function ssgPostUrl(entry: SubmissionEntry): string {
  return `${ssgRepoUrl(entry.platform, entry.owner, entry.repo)}/tree/HEAD/${POSTS_DIR}/${entry.slug}`;
}
