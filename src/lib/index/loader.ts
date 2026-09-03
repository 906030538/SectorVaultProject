import {
  INDEX_PATHS,
  MOCK_ARCHIVE_BASE,
  MOCK_INDEX_URL,
  type IndexSource,
} from '@/config';
import type { FilterState, IndexFile, SubmissionEntry, UserRecord } from '@/types';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getIndexSources } from '@/lib/index/sources';
import { isMockAvailable } from '@/lib/content';

/** 已加载索引缓存，避免重复请求（设计：缓存已加载的索引） */
const indexCache = new Map<string, IndexFile>();

function cacheKey(source: IndexSource, path: string): string {
  return `${source.platform}:${source.owner}/${source.repo}@${source.branch}:${path}`;
}

async function readIndexFile(
  source: IndexSource,
  path: string,
  signal?: AbortSignal,
): Promise<IndexFile> {
  const key = cacheKey(source, path);
  const cached = indexCache.get(key);
  if (cached) return cached;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const adapter = await getAdapterAsync(source.platform);
  const raw = await adapter.readFile(source.owner, source.repo, path, source.branch);
  const parsed = JSON.parse(raw) as IndexFile;
  indexCache.set(key, parsed);
  return parsed;
}

/**
 * 归档文件名列表（按月份倒序）：
 * 优先使用 current.json 的 archives 清单，缺失时列归档目录兜底。
 */
async function listArchiveFiles(
  source: IndexSource,
  current: IndexFile,
  signal?: AbortSignal,
): Promise<string[]> {
  const manifest = (current.archives ?? [])
    .map((a) => a.file)
    .filter((file) => file.endsWith('.json'));
  if (manifest.length > 0) return [...manifest].sort().reverse();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const adapter = await getAdapterAsync(source.platform);
  const files = await adapter.listDir(source.owner, source.repo, INDEX_PATHS.archiveDir, source.branch);
  return files
    .map((f) => f.name)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse();
}

function submissionKey(entry: SubmissionEntry): string {
  return `${entry.platform}:${entry.owner}/${entry.repo}/${entry.slug}`;
}

/** 用户记录合并（同 rebuild.mjs：按平台+用户名合并，repos 取并集） */
function mergeUserRecords(target: UserRecord[], incoming: UserRecord[]): void {
  for (const user of incoming) {
    const existing = target.find((u) => u.platform === user.platform && u.owner === user.owner);
    if (!existing) {
      target.push({ ...user, repos: (user.repos ?? []).map((r) => ({ ...r })) });
      continue;
    }
    const repos = new Set((existing.repos ?? []).map((r) => r.repo));
    for (const ref of user.repos ?? []) repos.add(ref.repo);
    existing.repos = [...repos].map((repo) => ({ repo }));
    existing.displayName = existing.displayName ?? user.displayName;
    existing.avatar = existing.avatar ?? user.avatar;
    existing.pagesUrl = existing.pagesUrl ?? user.pagesUrl;
  }
}

/** 合并多个索引文件：稿件按唯一键去重（先到先得），用户记录合并 */
function mergeIndexFiles(files: IndexFile[]): IndexFile {
  const merged: IndexFile = { submissions: [], users: [] };
  const seen = new Set<string>();
  for (const file of files) {
    for (const submission of file.submissions) {
      const key = submissionKey(submission);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.submissions.push(submission);
    }
    mergeUserRecords(merged.users, file.users);
  }
  return merged;
}

/** 单源加载失败时跳过该源（多源部署下单个坏源不阻断整站） */
function warnSourceFailure(source: IndexSource, error: unknown): void {
  console.warn(
    `[index] 源不可用，已跳过 ${source.platform}:${source.owner}/${source.repo}@${source.branch}:`,
    error,
  );
}

/** 未归档索引：全部索引源的 current.json 合并（按配置顺序，跨源去重） */
export async function loadActiveIndex(signal?: AbortSignal): Promise<IndexFile> {
  const parts: IndexFile[] = [];
  for (const source of await getIndexSources()) {
    try {
      parts.push(await readIndexFile(source, INDEX_PATHS.current, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      warnSourceFailure(source, error);
    }
  }
  return mergeIndexFiles(parts);
}

/** 主索引源的 current.json（编辑器索引 PR 的写入基准） */
export async function loadPrimaryIndex(
  signal?: AbortSignal,
): Promise<{ source: IndexSource; index: IndexFile }> {
  const source = (await getIndexSources())[0]!;
  return { source, index: await readIndexFile(source, INDEX_PATHS.current, signal) };
}

/** 归档不存在（404/Not Found）的判定 */
function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not found/i.test(message);
}

/**
 * 主索引源指定月份（YYYY-MM）的归档索引：
 * 归档不存在时返回 null（调用方创建只含本投稿的新归档）；其他错误抛出。
 */
export async function loadPrimaryArchive(
  month: string,
): Promise<{ source: IndexSource; index: IndexFile | null }> {
  const source = (await getIndexSources())[0]!;
  const adapter = await getAdapterAsync(source.platform);
  let raw: string;
  try {
    raw = await adapter.readFile(
      source.owner,
      source.repo,
      `${INDEX_PATHS.archiveDir}/${month}.json`,
      source.branch,
    );
  } catch (error) {
    if (isNotFoundError(error)) return { source, index: null };
    throw error;
  }
  return { source, index: JSON.parse(raw) as IndexFile };
}

/**
 * 按设计顺序遍历全部稿件：各索引源先 current.json 再按月归档，跨源去重。
 * 支持 AbortSignal 取消（对应列表页的取消按钮）。
 */
export async function* iterateAllSubmissions(
  signal?: AbortSignal,
): AsyncGenerator<SubmissionEntry, void, unknown> {
  const seen = new Set<string>();
  for (const source of await getIndexSources()) {
    try {
      const current = await readIndexFile(source, INDEX_PATHS.current, signal);
      for (const entry of current.submissions) {
        const key = submissionKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        yield entry;
      }

      const archives = await listArchiveFiles(source, current, signal);
      for (const file of archives) {
        const index = await readIndexFile(source, `${INDEX_PATHS.archiveDir}/${file}`, signal);
        for (const entry of index.submissions) {
          const key = submissionKey(entry);
          if (seen.has(key)) continue;
          seen.add(key);
          yield entry;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      warnSourceFailure(source, error);
    }
  }
}

/** 关键字搜索：遍历全部索引直至命中足够结果或遍历完毕 */
export async function searchSubmissions(
  keyword: string,
  { limit = 50, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<SubmissionEntry[]> {
  const kw = keyword.trim().toLowerCase();
  const results: SubmissionEntry[] = [];
  for await (const entry of iterateAllSubmissions(signal)) {
    const haystack = [entry.title, entry.owner, ...(entry.songs ?? [])]
      .join(' ')
      .toLowerCase();
    if (haystack.includes(kw)) {
      results.push(entry);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function applyFilters(
  entries: SubmissionEntry[],
  filters: FilterState,
): SubmissionEntry[] {
  return entries.filter((entry) => {
    if (filters.track && !(entry.songs ?? []).includes(filters.track)) return false;
    if (filters.engine && !(entry.engines ?? []).includes(filters.engine)) return false;
    if (filters.voicebank && !(entry.voicebanks ?? []).includes(filters.voicebank)) return false;
    if (filters.songLanguage && !(entry.languages ?? []).includes(filters.songLanguage))
      return false;
    return true;
  });
}

let mockIndexPromise: Promise<IndexFile> | undefined;

/**
 * 开发期加载本地模拟索引：读 current.json 并按其 archives 清单
 * 合并全部归档，得到与 iterateAllSubmissions 相同口径的完整集合。
 */
export async function loadMockIndex(): Promise<IndexFile> {
  mockIndexPromise ??= (async () => {
    const response = await fetch(MOCK_INDEX_URL);
    if (!response.ok) throw new Error(`Failed to load mock index: ${response.status}`);
    const current = (await response.json()) as IndexFile;
    const files = [...(current.archives ?? [])]
      .map((a) => a.file)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .reverse();
    const parts: IndexFile[] = [current];
    for (const file of files) {
      try {
        const res = await fetch(`${MOCK_ARCHIVE_BASE}/${file}`);
        if (res.ok) parts.push((await res.json()) as IndexFile);
      } catch {
        /* 归档缺失时仅用 current */
      }
    }
    return mergeIndexFiles(parts);
  })();
  return mockIndexPromise;
}

/** 按 owner/repo/slug 定位索引条目（详情页与编辑页共用） */
export async function findEntry(
  user: string,
  repo: string,
  slug: string,
): Promise<SubmissionEntry | null> {
  if (await isMockAvailable()) {
    const index = await loadMockIndex();
    return (
      index.submissions.find((e) => e.owner === user && e.repo === repo && e.slug === slug) ??
      null
    );
  }
  for await (const entry of iterateAllSubmissions()) {
    if (entry.owner === user && entry.repo === repo && entry.slug === slug) return entry;
  }
  return null;
}
