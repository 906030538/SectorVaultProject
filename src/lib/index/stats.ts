import type { EngagementStats, SubmissionEntry } from '@/types';
import type { GitPlatformAdapter } from '@/lib/adapters/types';

/** 互动统计缓存：同一稿件只拉取一次（设计：获取评论数和点赞数，并缓存） */
const engagementCache = new Map<string, EngagementStats>();

function key(entry: SubmissionEntry): string {
  return `${entry.platform}:${entry.owner}/${entry.repo}#${entry.slug}`;
}

/** 通过关联的 issue 与 release 统计评论数和点赞数 */
export async function fetchEngagement(
  adapter: GitPlatformAdapter,
  entry: SubmissionEntry,
): Promise<EngagementStats> {
  const cached = engagementCache.get(key(entry));
  if (cached) return cached;

  const [issues, releases] = await Promise.all([
    adapter.listIssues(entry.owner, entry.repo).catch(() => []),
    adapter.listReleases(entry.owner, entry.repo).catch(() => []),
  ]);

  const issue = issues.find((i) => i.title === entry.title);
  const release = releases.find((r) => r.tag === entry.slug);
  const stats: EngagementStats = {
    comments: issue?.comments ?? 0,
    reactions: release?.reactions ?? 0,
  };
  engagementCache.set(key(entry), stats);
  return stats;
}

/** 批量获取当前页稿件的互动统计（并发上限 4） */
export async function fetchEngagementForEntries(
  adapter: GitPlatformAdapter,
  entries: SubmissionEntry[],
): Promise<Map<string, EngagementStats>> {
  const results = new Map<string, EngagementStats>();
  const queue = [...entries];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      results.set(key(entry), await fetchEngagement(adapter, entry));
    }
  });
  await Promise.all(workers);
  return results;
}
