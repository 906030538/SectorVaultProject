import { INDEX_REPO, MOCK_INDEX_URL } from '@/config';
import type { FilterState, IndexFile, SubmissionEntry } from '@/types';
import type { GitPlatformAdapter } from '@/lib/adapters/types';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { isMockAvailable } from '@/lib/content';

/** 已加载索引缓存，避免重复请求（设计：缓存已加载的索引） */
const indexCache = new Map<string, IndexFile>();

function cacheKey(ref: string, path: string): string {
  return `${INDEX_REPO.owner}/${INDEX_REPO.name}@${ref}:${path}`;
}

async function readIndexFile(
  adapter: GitPlatformAdapter,
  path: string,
  signal?: AbortSignal,
): Promise<IndexFile> {
  const key = cacheKey(INDEX_REPO.branch, path);
  const cached = indexCache.get(key);
  if (cached) return cached;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const raw = await adapter.readFile(INDEX_REPO.owner, INDEX_REPO.name, path, INDEX_REPO.branch);
  const parsed = JSON.parse(raw) as IndexFile;
  indexCache.set(key, parsed);
  return parsed;
}

/** 未归档索引（最近 1024 条） */
export async function loadActiveIndex(
  adapter: GitPlatformAdapter,
  signal?: AbortSignal,
): Promise<IndexFile> {
  return readIndexFile(adapter, INDEX_REPO.activeFile, signal);
}

/**
 * 已归档索引文件名列表（index-<YYYY-MM>.json），按月份倒序。
 * 归档完成前默认索引可能尚未遍历完，调用方应先消费默认索引。
 */
export async function listArchiveFiles(
  adapter: GitPlatformAdapter,
  signal?: AbortSignal,
): Promise<string[]> {
  const files = await adapter.listDir(INDEX_REPO.owner, INDEX_REPO.name, '', INDEX_REPO.branch);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return files
    .map((f) => f.name)
    .filter((name) => name.startsWith(INDEX_REPO.archivePrefix) && name.endsWith('.json'))
    .sort()
    .reverse();
}

/**
 * 按设计顺序遍历全部稿件：先未归档索引，再依次加载按月归档的索引。
 * 支持 AbortSignal 取消（对应列表页的取消按钮）。
 */
export async function* iterateAllSubmissions(
  adapter: GitPlatformAdapter,
  signal?: AbortSignal,
): AsyncGenerator<SubmissionEntry, void, unknown> {
  const active = await loadActiveIndex(adapter, signal);
  yield* active.submissions;

  const archives = await listArchiveFiles(adapter, signal);
  for (const file of archives) {
    const index = await readIndexFile(adapter, file, signal);
    yield* index.submissions;
  }
}

/** 关键字搜索：遍历全部索引直至命中足够结果或遍历完毕 */
export async function searchSubmissions(
  adapter: GitPlatformAdapter,
  keyword: string,
  { limit = 50, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<SubmissionEntry[]> {
  const kw = keyword.trim().toLowerCase();
  const results: SubmissionEntry[] = [];
  for await (const entry of iterateAllSubmissions(adapter, signal)) {
    const haystack = [entry.title, entry.user, ...(entry.tracks ?? []), ...(entry.tags ?? [])]
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
    if (filters.track && !(entry.tracks ?? []).includes(filters.track)) return false;
    if (filters.engine && !(entry.engines ?? []).includes(filters.engine)) return false;
    if (filters.voicebank && !(entry.voicebanks ?? []).includes(filters.voicebank)) return false;
    if (filters.songLanguage && !(entry.songLanguages ?? []).includes(filters.songLanguage))
      return false;
    return true;
  });
}

/** 开发期从本地 mock 索引加载 */
export async function loadMockIndex(): Promise<IndexFile> {
  const response = await fetch(MOCK_INDEX_URL);
  if (!response.ok) throw new Error(`Failed to load mock index: ${response.status}`);
  return (await response.json()) as IndexFile;
}

/** 按 user/repo/slug 定位索引条目（详情页与编辑页共用） */
export async function findEntry(
  user: string,
  repo: string,
  slug: string,
): Promise<SubmissionEntry | null> {
  if (await isMockAvailable()) {
    const index = await loadMockIndex();
    return (
      index.submissions.find((e) => e.user === user && e.repo === repo && e.slug === slug) ??
      null
    );
  }
  for await (const entry of iterateAllSubmissions(await getAdapterAsync('github'))) {
    if (entry.user === user && entry.repo === repo && entry.slug === slug) return entry;
  }
  return null;
}
