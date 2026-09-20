import type { EngagementStats, Platform, SubmissionEntry } from '@/types';
import type { GitPlatformAdapter } from '@/lib/adapters/types';

/** 互动统计内存缓存：同一稿件只拉取一次 */
const engagementCache = new Map<string, EngagementStats>();

/**
 * localStorage 仓库级互动缓存：列出 issues 载荷自带点赞数的平台（GitHub）才写入，
 * 避免列表/用户空间/集合页为每个稿件重复请求列出 issues；稿件详情页优先读取。
 * TTL 与 current.json 一致（10 分钟）。
 */
const LS_PREFIX = 'svp-eng:';
const LS_TTL = 10 * 60 * 1000;

interface RepoEngagement {
  t: number;
  /** issue 标题（= slug）→ 互动数据 */
  issues: Record<string, { number: number | string; comments: number; likes: number }>;
}

function entryKey(entry: SubmissionEntry): string {
  return `${entry.platform}:${entry.owner}/${entry.repo}#${entry.slug}`;
}

function lsKey(platform: Platform, owner: string, repo: string): string {
  return `${LS_PREFIX}${platform}:${owner}/${repo}`;
}

/** 读取仓库级互动缓存；过期或不存在返回 null */
export function readRepoEngagement(
  platform: Platform,
  owner: string,
  repo: string,
): RepoEngagement['issues'] | null {
  try {
    const raw = localStorage.getItem(lsKey(platform, owner, repo));
    if (!raw) return null;
    const entry = JSON.parse(raw) as RepoEngagement;
    if (Date.now() - entry.t > LS_TTL) return null;
    return entry.issues && typeof entry.issues === 'object' ? entry.issues : null;
  } catch {
    return null;
  }
}

function writeRepoEngagement(
  platform: Platform,
  owner: string,
  repo: string,
  issues: RepoEngagement['issues'],
): void {
  if (!Object.keys(issues).length) return;
  try {
    localStorage.setItem(
      lsKey(platform, owner, repo),
      JSON.stringify({ t: Date.now(), issues } satisfies RepoEngagement),
    );
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 点赞/取消后同步刷新缓存中的点赞数（详情页互动时调用） */
export function bumpRepoEngagementLike(
  platform: Platform,
  owner: string,
  repo: string,
  issueNumber: number | string,
  delta: number,
): void {
  try {
    const raw = localStorage.getItem(lsKey(platform, owner, repo));
    if (!raw) return;
    const entry = JSON.parse(raw) as RepoEngagement;
    const record = Object.values(entry.issues ?? {}).find(
      (item) => String(item.number) === String(issueNumber),
    );
    if (!record) return;
    record.likes = Math.max(0, record.likes + delta);
    localStorage.setItem(lsKey(platform, owner, repo), JSON.stringify(entry));
  } catch {
    /* 缓存不可用时忽略 */
  }
}

/**
 * 单个仓库的互动统计：优先 localStorage 缓存；未命中列出全部 issues 一次，
 * 载荷自带点赞数（likes 字段）时直接使用并回写缓存（平台不提供时不缓存）。
 * issue 标题使用 slug：按 slug 关联留言；点赞 = issue 👍 表情数量。
 */
async function engageRepo(
  adapter: GitPlatformAdapter,
  platform: Platform,
  owner: string,
  repo: string,
  slugs: string[],
): Promise<Map<string, EngagementStats>> {
  const results = new Map<string, EngagementStats>();
  const apply = (slug: string, comments: number, likes: number): void => {
    const stats: EngagementStats = { comments, reactions: likes };
    results.set(`${platform}:${owner}/${repo}#${slug}`, stats);
    engagementCache.set(`${platform}:${owner}/${repo}#${slug}`, stats);
  };

  const cached = readRepoEngagement(platform, owner, repo);
  if (cached) {
    for (const slug of slugs) {
      const hit = cached[slug];
      apply(slug, hit?.comments ?? 0, hit?.likes ?? 0);
    }
    return results;
  }

  const issues = await adapter.listIssues(owner, repo).catch(() => []);
  // 载荷是否自带点赞数（GitHub 提供；gitee/atomgit 不提供则不写缓存）
  const hasLikes = issues.length > 0 && issues.every((issue) => issue.likes !== undefined);
  const cacheMap: RepoEngagement['issues'] = {};
  for (const issue of issues) {
    cacheMap[issue.title] = { number: issue.number, comments: issue.comments, likes: issue.likes ?? 0 };
  }
  if (hasLikes) writeRepoEngagement(platform, owner, repo, cacheMap);

  for (const slug of slugs) {
    const issue = issues.find((i) => i.title === slug);
    if (!issue) {
      apply(slug, 0, 0);
      continue;
    }
    if (issue.likes !== undefined) {
      // 列出载荷自带点赞数：无需逐 issue 请求表情列表
      apply(slug, issue.comments, issue.likes);
      continue;
    }
    // 平台载荷无点赞数：逐 issue 请求表情（不支持时点赞数为 0）
    let reactions = 0;
    try {
      const list = await adapter.listIssueReactions(owner, repo, issue.number);
      reactions = list.filter((r) => r.content === '+1').length;
    } catch {
      /* 平台不支持 issue 表情时点赞数为 0 */
    }
    apply(slug, issue.comments, reactions);
  }
  return results;
}

/** 通过关联 issue 统计评论数和点赞数（单稿件；走仓库级缓存与分组逻辑） */
export async function fetchEngagement(
  adapter: GitPlatformAdapter,
  entry: SubmissionEntry,
): Promise<EngagementStats> {
  const cached = engagementCache.get(entryKey(entry));
  if (cached) return cached;
  const map = await engageRepo(adapter, entry.platform, entry.owner, entry.repo, [entry.slug]);
  return map.get(entryKey(entry)) ?? { comments: 0, reactions: 0 };
}

/**
 * 批量获取当前页稿件的互动统计：按仓库分组各列出一次 issues
 * （localStorage 命中时零请求），分组并发上限 4。
 */
export async function fetchEngagementForEntries(
  adapter: GitPlatformAdapter,
  entries: SubmissionEntry[],
): Promise<Map<string, EngagementStats>> {
  const groups = new Map<
    string,
    { platform: Platform; owner: string; repo: string; slugs: string[] }
  >();
  for (const entry of entries) {
    const id = `${entry.platform}:${entry.owner}/${entry.repo}`;
    const group = groups.get(id) ?? {
      platform: entry.platform,
      owner: entry.owner,
      repo: entry.repo,
      slugs: [],
    };
    if (!group.slugs.includes(entry.slug)) group.slugs.push(entry.slug);
    groups.set(id, group);
  }

  const results = new Map<string, EngagementStats>();
  const queue = [...groups.values()];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length > 0) {
      const group = queue.shift();
      if (!group) break;
      for (const [key, stats] of await engageRepo(
        adapter,
        group.platform,
        group.owner,
        group.repo,
        group.slugs,
      )) {
        results.set(key, stats);
      }
    }
  });
  await Promise.all(workers);
  return results;
}
