import type { EngagementStats, SubmissionEntry } from '@/types';
import type { GitPlatformAdapter } from '@/lib/adapters/types';

/** 互动统计缓存：同一稿件只拉取一次（设计：获取评论数和点赞数，并缓存） */
const engagementCache = new Map<string, EngagementStats>();

function key(entry: SubmissionEntry): string {
  return `${entry.platform}:${entry.owner}/${entry.repo}#${entry.slug}`;
}

/** 通过关联 issue 统计评论数和点赞数（点赞 = issue 👍 表情数量） */
export async function fetchEngagement(
  adapter: GitPlatformAdapter,
  entry: SubmissionEntry,
): Promise<EngagementStats> {
  const cached = engagementCache.get(key(entry));
  if (cached) return cached;

  const issues = await adapter.listIssues(entry.owner, entry.repo).catch(() => []);

  // issue 标题使用 slug：按 slug 关联留言
  const issue = issues.find((i) => i.title === entry.slug);
  let reactions = 0;
  if (issue) {
    try {
      const list = await adapter.listIssueReactions(entry.owner, entry.repo, issue.number);
      reactions = list.filter((r) => r.content === '+1').length;
    } catch {
      /* 平台不支持 issue 表情时点赞数为 0 */
    }
  }
  const stats: EngagementStats = {
    comments: issue?.comments ?? 0,
    reactions,
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
